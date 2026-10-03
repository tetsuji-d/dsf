#include "archive.hpp"
#include <wincodec.h>
#include <algorithm>
#include <memory>
#include <stdexcept>
#include <cstring>
#include <webp/decode.h>

namespace dsf {
template<class T> struct Com {
    T* p = nullptr;
    ~Com() { if (p) p->Release(); }
    T** out() { return &p; }
    T* operator->() { return p; }
};
static void check(HRESULT hr) { if (FAILED(hr)) throw std::runtime_error("IMAGE_DECODE_OR_CODEC_UNAVAILABLE"); }
static void checkDimensions(UINT width, UINT height) {
    if (!width || !height || width > 16384 || height > 16384 || uint64_t(width) * height > 32000000)
        throw std::runtime_error("IMAGE_DIMENSION_LIMIT");
}
static HBITMAP renderWebp(const Cover& cover, unsigned edge) {
    WebPDecoderConfig config{};
    if (!WebPInitDecoderConfig(&config) || WebPGetFeatures(cover.bytes.data(), cover.bytes.size(), &config.input) != VP8_STATUS_OK)
        throw std::runtime_error("WEBP_INVALID");
    if (config.input.has_animation) throw std::runtime_error("ANIMATED_IMAGE_UNSUPPORTED");
    checkDimensions(config.input.width, config.input.height);
    const double scale = std::min(1.0, double(edge) / std::max(config.input.width, config.input.height));
    const UINT w = std::max(1u, UINT(config.input.width * scale)), h = std::max(1u, UINT(config.input.height * scale));
    BITMAPINFO info{}; info.bmiHeader.biSize = sizeof(BITMAPINFOHEADER);
    info.bmiHeader.biWidth = w; info.bmiHeader.biHeight = -LONG(h);
    info.bmiHeader.biPlanes = 1; info.bmiHeader.biBitCount = 32; info.bmiHeader.biCompression = BI_RGB;
    void* pixels = nullptr;
    HBITMAP bitmap = CreateDIBSection(nullptr, &info, DIB_RGB_COLORS, &pixels, nullptr, 0);
    if (!bitmap) throw std::runtime_error("BITMAP_ALLOCATION_FAILED");
    config.options.use_scaling = 1; config.options.scaled_width = w; config.options.scaled_height = h;
    config.output.colorspace = MODE_bgrA; // Premultiplied BGRA required by Windows Shell.
    config.output.is_external_memory = 1;
    config.output.u.RGBA.rgba = static_cast<uint8_t*>(pixels);
    config.output.u.RGBA.stride = w * 4; config.output.u.RGBA.size = w * h * 4;
    const auto result = WebPDecode(cover.bytes.data(), cover.bytes.size(), &config);
    WebPFreeDecBuffer(&config.output);
    if (result != VP8_STATUS_OK) { DeleteObject(bitmap); throw std::runtime_error("WEBP_INVALID"); }
    return bitmap;
}
HBITMAP renderCover(const Cover& cover, unsigned edge) {
    if (edge < 1 || edge > 1024) throw std::runtime_error("THUMBNAIL_SIZE_LIMIT");
    // Ship the decoder: never depend on a Store/third-party WebP WIC codec.
    if (cover.bytes.size() >= 12 && !memcmp(cover.bytes.data(), "RIFF", 4) && !memcmp(cover.bytes.data()+8, "WEBP", 4))
        return renderWebp(cover, edge);
    Com<IWICImagingFactory> factory;
    check(CoCreateInstance(CLSID_WICImagingFactory, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(factory.out())));
    Com<IWICStream> stream; check(factory->CreateStream(stream.out()));
    check(stream->InitializeFromMemory(const_cast<BYTE*>(cover.bytes.data()), static_cast<DWORD>(cover.bytes.size())));
    Com<IWICBitmapDecoder> decoder;
    check(factory->CreateDecoderFromStream(stream.p, nullptr, WICDecodeMetadataCacheOnDemand, decoder.out()));
    GUID format{}; check(decoder->GetContainerFormat(&format));
    // Only raster containers are accepted; SVG/HTML never reach an executable renderer.
    if (format != GUID_ContainerFormatPng && format != GUID_ContainerFormatJpeg)
        throw std::runtime_error("RASTER_FORMAT_UNSUPPORTED");
    UINT count = 0; check(decoder->GetFrameCount(&count));
    if (count != 1) throw std::runtime_error("ANIMATED_IMAGE_UNSUPPORTED");
    Com<IWICBitmapFrameDecode> frame; check(decoder->GetFrame(0, frame.out()));
    UINT width = 0, height = 0; check(frame->GetSize(&width, &height));
    checkDimensions(width, height);
    double scale = std::min(1.0, double(edge) / std::max(width, height));
    UINT w = std::max(1u, UINT(width * scale)), h = std::max(1u, UINT(height * scale));
    Com<IWICBitmapScaler> scaler; check(factory->CreateBitmapScaler(scaler.out()));
    check(scaler->Initialize(frame.p, w, h, WICBitmapInterpolationModeFant));
    Com<IWICFormatConverter> converter; check(factory->CreateFormatConverter(converter.out()));
    check(converter->Initialize(scaler.p, GUID_WICPixelFormat32bppPBGRA, WICBitmapDitherTypeNone, nullptr, 0, WICBitmapPaletteTypeCustom));
    BITMAPINFO info{}; info.bmiHeader.biSize = sizeof(BITMAPINFOHEADER);
    info.bmiHeader.biWidth = w; info.bmiHeader.biHeight = -LONG(h);
    info.bmiHeader.biPlanes = 1; info.bmiHeader.biBitCount = 32; info.bmiHeader.biCompression = BI_RGB;
    void* pixels = nullptr;
    HBITMAP bitmap = CreateDIBSection(nullptr, &info, DIB_RGB_COLORS, &pixels, nullptr, 0);
    if (!bitmap) throw std::runtime_error("BITMAP_ALLOCATION_FAILED");
    HRESULT result = converter->CopyPixels(nullptr, w * 4, w * h * 4, static_cast<BYTE*>(pixels));
    if (FAILED(result)) { DeleteObject(bitmap); check(result); }
    return bitmap;
}
void writePng(HBITMAP bitmap, const wchar_t* path) {
    Com<IWICImagingFactory> factory;
    check(CoCreateInstance(CLSID_WICImagingFactory, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(factory.out())));
    Com<IWICBitmap> source; check(factory->CreateBitmapFromHBITMAP(bitmap, nullptr, WICBitmapUsePremultipliedAlpha, source.out()));
    Com<IWICStream> stream; check(factory->CreateStream(stream.out()));
    check(stream->InitializeFromFilename(path, GENERIC_WRITE));
    Com<IWICBitmapEncoder> encoder; check(factory->CreateEncoder(GUID_ContainerFormatPng, nullptr, encoder.out()));
    check(encoder->Initialize(stream.p, WICBitmapEncoderNoCache));
    Com<IWICBitmapFrameEncode> frame; check(encoder->CreateNewFrame(frame.out(), nullptr));
    check(frame->Initialize(nullptr)); check(frame->WriteSource(source.p, nullptr));
    check(frame->Commit()); check(encoder->Commit());
}
}
