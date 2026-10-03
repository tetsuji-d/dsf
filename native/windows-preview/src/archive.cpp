#include "archive.hpp"
#include "miniz.h"
#include "json.hpp"
#include <bcrypt.h>
#include <algorithm>
#include <cctype>
#include <map>
#include <set>
#include <stdexcept>

namespace dsf {
using Json = nlohmann::json;
constexpr size_t jsonLimit = 8 * 1024 * 1024, imageLimit = 32 * 1024 * 1024;
static void need(bool ok, const char* message) { if (!ok) throw std::runtime_error(message); }
static size_t readAt(void* opaque, mz_uint64 offset, void* out, size_t count) {
    auto stream = static_cast<IStream*>(opaque);
    LARGE_INTEGER pos; pos.QuadPart = offset;
    if (offset > 0x7fffffffffffffffULL || count > MAXDWORD || FAILED(stream->Seek(pos, STREAM_SEEK_SET, nullptr))) return 0;
    ULONG got = 0;
    return SUCCEEDED(stream->Read(out, static_cast<ULONG>(count), &got)) ? got : 0;
}
static uint32_t u32(const unsigned char* b) { return b[0] | (uint32_t(b[1]) << 8) | (uint32_t(b[2]) << 16) | (uint32_t(b[3]) << 24); }
static uint16_t u16(const unsigned char* b) { return b[0] | (uint16_t(b[1]) << 8); }
static bool safePath(const std::string& path) {
    if (path.empty() || path.size() > 512 || path.front() == '/' || path.find_first_of("\\:%?#") != path.npos) return false;
    size_t start = 0;
    while (start < path.size()) {
        size_t end = path.find('/', start); if (end == path.npos) end = path.size();
        auto part = path.substr(start, end - start);
        if (part.empty() || part == "." || part == ".." || part.back() == '.' || part.back() == ' ') return false;
        for (unsigned char c : part) if (c < 32 || c == 127) return false;
        start = end + 1;
    }
    return true;
}
static std::string sha256(const std::vector<unsigned char>& bytes) {
    unsigned char digest[32];
    need(BCryptHash(BCRYPT_SHA256_ALG_HANDLE, nullptr, 0, const_cast<PUCHAR>(bytes.data()), static_cast<ULONG>(bytes.size()), digest, 32) >= 0, "HASH_FAILED");
    constexpr char hex[] = "0123456789abcdef";
    std::string result; for (auto b : digest) { result += hex[b >> 4]; result += hex[b & 15]; } return result;
}
class Archive {
    mz_zip_archive zip{};
    bool opened = false;
    std::map<std::string, mz_uint> entries;
public:
    explicit Archive(IStream* stream) {
        STATSTG stat{};
        need(stream && SUCCEEDED(stream->Stat(&stat, STATFLAG_NONAME)), "STREAM_UNREADABLE");
        uint64_t size = stat.cbSize.QuadPart;
        need(size >= 22 && size <= 1024ULL * 1024 * 1024, "ARCHIVE_SIZE_LIMIT");
        // Bound the central directory before the ZIP library allocates memory.
        std::vector<unsigned char> tail(static_cast<size_t>(std::min<uint64_t>(size, 65557)));
        need(readAt(stream, size - tail.size(), tail.data(), tail.size()) == tail.size(), "ZIP_TRUNCATED");
        bool valid = false;
        for (size_t i = tail.size() - 22;; --i) {
            const auto* b = tail.data() + i;
            if (u32(b) == 0x06054b50 && i + 22 + u16(b + 20) == tail.size()) {
                need(u16(b + 4) == 0 && u16(b + 6) == 0 && u16(b + 8) == u16(b + 10), "ZIP_MULTIDISK_UNSUPPORTED");
                need(u16(b + 10) <= 10000 && u32(b + 12) <= jsonLimit && uint64_t(u32(b + 16)) + u32(b + 12) == size - tail.size() + i, "ZIP_DIRECTORY_LIMIT");
                valid = true; break;
            }
            if (!i) break;
        }
        need(valid, "ZIP_DIRECTORY_INVALID");
        zip.m_pRead = readAt; zip.m_pIO_opaque = stream;
        opened = mz_zip_reader_init(&zip, size, 0);
        need(opened, "ZIP_INVALID");
        try {
            std::set<std::string> names;
            for (mz_uint i = 0; i < mz_zip_reader_get_num_files(&zip); ++i) {
                mz_zip_archive_file_stat st{};
                need(mz_zip_reader_file_stat(&zip, i, &st), "ZIP_ENTRY_INVALID");
                auto length = mz_zip_reader_get_filename(&zip, i, nullptr, 0);
                need(length > 0 && length <= 513, "ZIP_PATH_TOO_LONG");
                std::string name = st.m_filename;
                need(safePath(name), "ZIP_PATH_INVALID");
                auto folded = name;
                std::transform(folded.begin(), folded.end(), folded.begin(), [](unsigned char c) { return std::tolower(c); });
                need(names.insert(folded).second, "ZIP_DUPLICATE_PATH");
                need(!st.m_is_encrypted && (st.m_method == 0 || st.m_method == 8), "ZIP_COMPRESSION_UNSUPPORTED");
                if (!st.m_is_directory) entries.emplace(name, i);
            }
        } catch (...) { mz_zip_reader_end(&zip); opened = false; throw; }
    }
    ~Archive() { if (opened) mz_zip_reader_end(&zip); }
    bool has(const std::string& path) const { return entries.count(path) != 0; }
    std::vector<unsigned char> read(const std::string& path, size_t limit) {
        need(safePath(path) && has(path), "ASSET_MISSING_OR_UNSAFE");
        mz_zip_archive_file_stat st{};
        need(mz_zip_reader_file_stat(&zip, entries.at(path), &st), "ZIP_ENTRY_INVALID");
        need(st.m_uncomp_size > 0 && st.m_uncomp_size <= limit && st.m_comp_size <= limit, "ENTRY_SIZE_LIMIT");
        std::vector<unsigned char> bytes(static_cast<size_t>(st.m_uncomp_size));
        need(mz_zip_reader_extract_to_mem(&zip, entries.at(path), bytes.data(), bytes.size(), 0), "ENTRY_CRC_INVALID");
        return bytes;
    }
    Json json(const std::string& path) {
        auto bytes = read(path, jsonLimit);
        std::vector<std::set<std::string>> keys;
        auto result = Json::parse(bytes, [&](int depth, Json::parse_event_t event, Json& value) {
            need(depth < 64, "JSON_DEPTH_LIMIT");
            if (event == Json::parse_event_t::object_start) keys.emplace_back();
            if (event == Json::parse_event_t::key) need(keys.back().insert(value.get<std::string>()).second, "JSON_DUPLICATE_KEY");
            if (event == Json::parse_event_t::object_end) keys.pop_back();
            return true;
        });
        need(result.is_object(), "JSON_OBJECT_REQUIRED"); return result;
    }
    void verify(const Json& manifest, const std::string& path, const std::vector<unsigned char>& bytes) {
        need(manifest.value("format", "") == "dsf-archive-manifest-1" && manifest.value("schemaVersion", 0) == 1, "MANIFEST_UNSUPPORTED");
        const auto& files = manifest.at("files"); need(files.is_array() && files.size() <= 10000, "MANIFEST_INVALID");
        size_t matches = 0;
        for (const auto& file : files) if (file.at("path") == path) {
            ++matches;
            need(file.at("byteLength") == bytes.size() && file.at("sha256") == sha256(bytes), "MANIFEST_HASH_MISMATCH");
        }
        need(matches == 1, "MANIFEST_ASSET_MISSING");
    }
};
static std::string imagePath(const Json& page, const std::string& lang) {
    if (page.contains("urls")) return page.at("urls").value(lang, "");
    const auto& content = page.contains("content") ? page.at("content") : page;
    if (content.contains("backgrounds")) return content.at("backgrounds").value(lang, "");
    return content.value("background", "");
}
Cover readCover(IStream* stream) {
    Archive archive(stream);
    auto mimeBytes = archive.read("mimetype", 128);
    std::string mime(mimeBytes.begin(), mimeBytes.end());
    if (mime == "application/vnd.dsf.project+zip") {
        // Never infer a composed cover from raw authoring backgrounds.
        need(archive.has("preview/cover.png") && archive.has("preview/cover.json"), "DSP_SNAPSHOT_REQUIRED");
        auto project = archive.json("project.json"), info = archive.json("preview/cover.json");
        need((project.value("version", 0) == 5 || project.value("version", 0) == 6) && info.value("schemaVersion", 0) == 1, "DSP_PREVIEW_SCHEMA_UNSUPPORTED");
        need(info.at("language") == project.value("defaultLang", "ja") && info.at("width") == 360 && info.at("height") == 640, "DSP_PREVIEW_METADATA_INVALID");
        auto bytes = archive.read("preview/cover.png", 1024 * 1024);
        need(info.at("sourceSha256") == sha256(archive.read("project.json", jsonLimit)) && info.at("imageSha256") == sha256(bytes), "DSP_PREVIEW_HASH_MISMATCH");
        const unsigned char signature[] = {137,80,78,71,13,10,26,10};
        need(bytes.size() >= 24 && std::equal(signature, signature + 8, bytes.begin()), "DSP_PREVIEW_NOT_PNG");
        auto be32 = [](const unsigned char* b) { return (uint32_t(b[0]) << 24) | (uint32_t(b[1]) << 16) | (uint32_t(b[2]) << 8) | b[3]; };
        need(be32(bytes.data() + 16) == 360 && be32(bytes.data() + 20) == 640, "DSP_PREVIEW_DIMENSIONS_INVALID");
        return {std::move(bytes), "preview/cover.png"};
    }
    need(mime == "application/vnd.dsf.content+zip", "MIMETYPE_UNSUPPORTED");
    auto meta = archive.json("meta.json"), content = archive.json("content.json");
    const auto lang = content.value("defaultLang", meta.value("defaultLang", "ja"));
    std::string path;
    if (content.value("schemaVersion", 1) == 2) {
        need(content.value("layoutModel", "") == "fixed-page-hybrid-1", "LAYOUT_MODEL_UNSUPPORTED");
        auto manifest = archive.json("manifest.json");
        archive.verify(manifest, "content.json", archive.read("content.json", jsonLimit));
        archive.verify(manifest, "meta.json", archive.read("meta.json", jsonLimit));
        auto ref = content.at("languages").at(lang).at("href").get<std::string>();
        need(safePath(ref) && ref.rfind("content/", 0) == 0, "LANGUAGE_PATH_INVALID");
        auto languageBytes = archive.read(ref, jsonLimit);
        archive.verify(manifest, ref, languageBytes);
        need(content.at("languages").at(lang).at("sha256") == sha256(languageBytes), "LANGUAGE_HASH_MISMATCH");
        auto language = archive.json(ref);
        need(language.value("schemaVersion", 0) == 1 && language.value("language", "") == lang, "LANGUAGE_MANIFEST_UNSUPPORTED");
        const auto& first = language.at("pages").at(0);
        need(first.value("renderKind", "") == "image", "FIXED_TEXT_COVER_UNSUPPORTED");
        path = first.at("image").at("href").get<std::string>();
        // Production paths resolve exactly one ../ from content/ to assets/.
        need(ref.find('/', 8) == ref.npos && path.rfind("../assets/", 0) == 0, "IMAGE_PATH_INVALID");
        path.erase(0, 3);
        auto bytes = archive.read(path, imageLimit);
        archive.verify(manifest, path, bytes);
        return {std::move(bytes), path};
    }
    need(content.value("schemaVersion", 1) == 1 && !archive.has("manifest.json"), "SCHEMA_UNSUPPORTED");
    size_t index = 0;
    if (content.contains("book") && content.at("book").contains("covers") && content.at("book").at("covers").contains("c1")) {
        const auto& c1 = content.at("book").at("covers").at("c1");
        if (c1.is_object() && c1.contains("pageIndex")) index = c1.at("pageIndex").get<size_t>();
    }
    const auto& pages = content.contains("dsfPages") && !content.at("dsfPages").empty() ? content.at("dsfPages") : content.at("pages");
    need(pages.is_array() && !pages.empty() && index < pages.size(), "COVER_PAGE_MISSING");
    path = imagePath(pages.at(index), lang);
    need(path.rfind("assets/", 0) == 0, "IMAGE_PATH_INVALID");
    return {archive.read(path, imageLimit), path};
}
}
