#include "archive.hpp"
#include <shlwapi.h>
#include <shobjidl.h>
#include <shlobj.h>
#include <shlguid.h>
#include <thumbcache.h>
#include <sddl.h>
#include <cstdio>
#include <stdexcept>

int wmain(int argc, wchar_t** argv) {
    if (argc == 2 && wcscmp(argv[1], L"--hosts") == 0) {
        if (FAILED(CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED))) return 3;
        for (const auto id : {L"{AB8902B4-09CA-4BB6-B78D-A8F59079A8D5}", L"{4545DEA0-2DFC-4906-A728-6D986BA399A9}"}) {
            CLSID clsid; CLSIDFromString(id, &clsid); IUnknown* object = nullptr;
            HRESULT hr = CoCreateInstance(clsid, nullptr, CLSCTX_LOCAL_SERVER, IID_PPV_ARGS(&object));
            fwprintf(stderr, L"System host %ls: 0x%08lx\n", id, static_cast<unsigned long>(hr));
            if (object) object->Release();
        }
        CoUninitialize(); return 0;
    }
    if (argc == 2 && wcscmp(argv[1], L"--notify") == 0) {
        SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_IDLIST, nullptr, nullptr);
        return 0;
    }
    if (argc != 3 && argc != 4) { fputs("Usage: dsf-thumbnail-check input.dsf output.png [provider.dll]\n", stderr); return 2; }
    const bool lowProbe = argc == 4 && wcscmp(argv[3], L"--registered-low") == 0;
    if (lowProbe) {
        // Reduce only this disposable diagnostic process; do not change OS policy.
        HANDLE token = nullptr; PSID sid = nullptr;
        if (!OpenProcessToken(GetCurrentProcess(), TOKEN_ADJUST_DEFAULT | TOKEN_QUERY, &token)) return 4;
        if (!ConvertStringSidToSidW(L"S-1-16-4096", &sid)) { CloseHandle(token); return 4; }
        TOKEN_MANDATORY_LABEL label = {{sid, SE_GROUP_INTEGRITY}};
        BOOL ok = SetTokenInformation(token, TokenIntegrityLevel, &label, sizeof(label) + GetLengthSid(sid));
        LocalFree(sid); CloseHandle(token);
        if (!ok) { fprintf(stderr, "LOW_PROBE_UNAVAILABLE: %lu\n", GetLastError()); return 4; }
    }
    if (FAILED(CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED))) return 3;
    IStream* stream = nullptr; HBITMAP bitmap = nullptr; HMODULE module = nullptr;
    IClassFactory* factory = nullptr; IInitializeWithStream* init = nullptr; IThumbnailProvider* provider = nullptr;
    IShellItemImageFactory* shellImage = nullptr;
    int result = 0;
    try {
        if (FAILED(SHCreateStreamOnFileEx(argv[1], STGM_READ | STGM_SHARE_DENY_WRITE, 0, FALSE, nullptr, &stream))) throw std::runtime_error("FILE_UNREADABLE");
        if (argc == 4 && wcscmp(argv[3], L"--bind") == 0) {
            IShellItem* item = nullptr;
            HRESULT hr = SHCreateItemFromParsingName(argv[1], nullptr, IID_PPV_ARGS(&item));
            if (SUCCEEDED(hr)) {
                hr = item->BindToHandler(nullptr, BHID_ThumbnailHandler, IID_PPV_ARGS(&provider));
                item->Release();
            }
            fprintf(stderr, "Thumbnail handler binding: 0x%08lx\n", static_cast<unsigned long>(hr));
            if (FAILED(hr)) throw std::runtime_error("SHELL_BIND_FAILED");
            WTS_ALPHATYPE alpha;
            hr = provider->GetThumbnail(256, &bitmap, &alpha);
            fprintf(stderr, "Bound thumbnail extraction: 0x%08lx\n", static_cast<unsigned long>(hr));
            if (FAILED(hr)) throw std::runtime_error("SHELL_BOUND_THUMBNAIL_FAILED");
        } else if (argc == 4 && wcscmp(argv[3], L"--shell") == 0) {
            wchar_t handler[128] = {}; DWORD count = 128;
            HRESULT query = AssocQueryStringW(ASSOCF_NONE, ASSOCSTR_SHELLEXTENSION, PathFindExtensionW(argv[1]),
                L"{E357FCCD-A995-4576-B01F-234630154E96}", handler, &count);
            fwprintf(stderr, L"Association HRESULT: 0x%08lx, handler: %ls\n", static_cast<unsigned long>(query), handler);
            if (FAILED(SHCreateItemFromParsingName(argv[1], nullptr, IID_PPV_ARGS(&shellImage)))) throw std::runtime_error("SHELL_ITEM_FAILED");
            HRESULT hr = shellImage->GetImage({256,256}, SIIGBF_THUMBNAILONLY, &bitmap);
            if (FAILED(hr)) {
                fprintf(stderr, "Shell HRESULT: 0x%08lx\n", static_cast<unsigned long>(hr));
                IThumbnailCache* cache = nullptr;
                HRESULT cacheHr = CoCreateInstance(__uuidof(LocalThumbnailCache), nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&cache));
                fprintf(stderr, "Thumbnail cache activation: 0x%08lx\n", static_cast<unsigned long>(cacheHr));
                if (cache) {
                    IShellItem* item = nullptr;
                    if (SUCCEEDED(shellImage->QueryInterface(IID_PPV_ARGS(&item)))) {
                        ISharedBitmap* shared = nullptr;
                        cacheHr = cache->GetThumbnail(item, 256, WTS_EXTRACTDONOTCACHE, &shared, nullptr, nullptr);
                        fprintf(stderr, "Thumbnail cache extraction: 0x%08lx\n", static_cast<unsigned long>(cacheHr));
                        if (shared) shared->Release();
                        item->Release();
                    }
                    cache->Release();
                }
                throw std::runtime_error("SHELL_THUMBNAIL_FAILED");
            }
        } else if (argc == 4) {
            CLSID clsid = {0x7e47a067,0x4769,0x4cdc,{0xa9,0xa2,0x75,0xcd,0x67,0xec,0xbc,0xc1}};
            if (lowProbe || wcscmp(argv[3], L"--registered") == 0 || wcscmp(argv[3], L"--surrogate") == 0) {
                HRESULT hr=CoCreateInstance(clsid,nullptr,wcscmp(argv[3], L"--surrogate") == 0 ? CLSCTX_LOCAL_SERVER : CLSCTX_INPROC_SERVER,IID_PPV_ARGS(&init));
                if (FAILED(hr)) { fprintf(stderr,"COM HRESULT: 0x%08lx\n",static_cast<unsigned long>(hr)); throw std::runtime_error("REGISTERED_COM_FAILED"); }
            } else {
                module = LoadLibraryExW(argv[3], nullptr, LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR | LOAD_LIBRARY_SEARCH_SYSTEM32);
                if (!module) throw std::runtime_error("DLL_LOAD_FAILED");
                auto getClass = reinterpret_cast<HRESULT (__stdcall*)(REFCLSID, REFIID, void**)>(GetProcAddress(module, "DllGetClassObject"));
                if (!getClass || FAILED(getClass(clsid, IID_PPV_ARGS(&factory))) || FAILED(factory->CreateInstance(nullptr, IID_PPV_ARGS(&init)))) throw std::runtime_error("COM_CREATE_FAILED");
            }
            if (FAILED(init->Initialize(stream, STGM_READ)) || FAILED(init->QueryInterface(IID_PPV_ARGS(&provider)))) throw std::runtime_error("COM_INITIALIZE_FAILED");
            WTS_ALPHATYPE alpha;
            if (FAILED(provider->GetThumbnail(256, &bitmap, &alpha)) || alpha != WTSAT_ARGB) throw std::runtime_error("COM_THUMBNAIL_FAILED");
        } else {
            auto cover = dsf::readCover(stream);
            bitmap = dsf::renderCover(cover, 256);
        }
        if (!lowProbe) dsf::writePng(bitmap, argv[2]);
        puts("THUMBNAIL_OK");
    } catch (const std::exception& error) { fprintf(stderr, "%s\n", error.what()); result = 1; }
    if (bitmap) DeleteObject(bitmap);
    if (provider) provider->Release(); if (init) init->Release(); if (factory) factory->Release();
    if (shellImage) shellImage->Release();
    if (stream) stream->Release(); if (module) FreeLibrary(module);
    CoUninitialize(); return result;
}
