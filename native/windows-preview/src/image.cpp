#include "archive.hpp"
#include <wincodec.h>
#include <algorithm>
#include <memory>
#include <stdexcept>

namespace dsf {
template<class T> struct Com {
    T* p = nullptr;
    ~Com() { if (p) p->Release(); }
    T** out() { return &p; }
    T* operator->() { return p; }
};
static void check(HRESULT hr) { if (FAILED(hr)) throw std::runtime_error("IMAGE_DECODE_OR_CODEC_UNAVAILABLE"); }
HBITMAP renderCover(const Cover& cover, unsigned edge) {
    if (edge < 1 || edge > 1024) throw std::runtime_error("THUMBNAIL_SIZE_LIMIT");
    Com<IWICImagingFactory> factory;
    check(CoCreateInstance(CLSID_WICImagingFactory, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(factory.out())));
    Com<IWICStream> stream; check(factory->CreateStream(stream.out()));
    check(stream->InitializeFromMemory(const_cast<BYTE*>(cover.bytes.data()), static_cast<DWORD>(cover.bytes.size())));
    Com<IWICBitmapDecoder> decoder;
    check(factory->CreateDecoderFromStream(stream.p, nullptr, WICDecodeMetadataCacheOnDemand, decoder.out()));
    GUID format{}; check(decoder->GetContainerFormat(&format));
    // Only raster containers are accepted; SVG/HTML never reach an executable renderer.
    const GUID webp = {0xe094b0e2, 0x67f2, 0x45b3, {0xb0,0xea,0x11,0x53,0x37,0xca,0x7c,0xf3}};
    if (format != GUID_ContainerFormatPng && format != GUID_ContainerFormatJpeg && format != webp)
        throw std::runtime_error("RASTER_FORMAT_UNSUPPORTED");
    UINT count = 0; check(decoder->GetFrameCount(&count));
    if (count != 1) throw std::runtime_error("ANIMATED_IMAGE_UNSUPPORTED");
    Com<IWICBitmapFrameDecode> frame; check(decoder->GetFrame(0, frame.out()));
    UINT width = 0, height = 0; check(frame->GetSize(&width, &height));
    if (!width || !height || width > 16384 || height > 16384 || uint64_t(width) * height > 32000000)
        throw std::runtime_error("IMAGE_DIMENSION_LIMIT");
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
