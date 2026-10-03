#include "archive.hpp"
#include <shlwapi.h>
#include <shobjidl.h>
#include <thumbcache.h>
#include <cstdio>
#include <stdexcept>

int wmain(int argc, wchar_t** argv) {
    if (argc != 3 && argc != 4) { fputs("Usage: dsf-thumbnail-check input.dsf output.png [provider.dll]\n", stderr); return 2; }
    if (FAILED(CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED))) return 3;
    IStream* stream = nullptr; HBITMAP bitmap = nullptr; HMODULE module = nullptr;
    IClassFactory* factory = nullptr; IInitializeWithStream* init = nullptr; IThumbnailProvider* provider = nullptr;
    IShellItemImageFactory* shellImage = nullptr;
    int result = 0;
    try {
        if (FAILED(SHCreateStreamOnFileEx(argv[1], STGM_READ | STGM_SHARE_DENY_WRITE, 0, FALSE, nullptr, &stream))) throw std::runtime_error("FILE_UNREADABLE");
        if (argc == 4 && wcscmp(argv[3], L"--shell") == 0) {
            if (FAILED(SHCreateItemFromParsingName(argv[1], nullptr, IID_PPV_ARGS(&shellImage)))) throw std::runtime_error("SHELL_ITEM_FAILED");
            HRESULT hr = shellImage->GetImage({256,256}, SIIGBF_THUMBNAILONLY, &bitmap);
            if (FAILED(hr)) { fprintf(stderr, "Shell HRESULT: 0x%08lx\n", static_cast<unsigned long>(hr)); throw std::runtime_error("SHELL_THUMBNAIL_FAILED"); }
        } else if (argc == 4) {
            CLSID clsid = {0x7e47a067,0x4769,0x4cdc,{0xa9,0xa2,0x75,0xcd,0x67,0xec,0xbc,0xc1}};
            if (wcscmp(argv[3], L"--registered") == 0) {
                HRESULT hr=CoCreateInstance(clsid,nullptr,CLSCTX_INPROC_SERVER,IID_PPV_ARGS(&init));
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
        dsf::writePng(bitmap, argv[2]); puts("THUMBNAIL_OK");
    } catch (const std::exception& error) { fprintf(stderr, "%s\n", error.what()); result = 1; }
    if (bitmap) DeleteObject(bitmap);
    if (provider) provider->Release(); if (init) init->Release(); if (factory) factory->Release();
    if (shellImage) shellImage->Release();
    if (stream) stream->Release(); if (module) FreeLibrary(module);
    CoUninitialize(); return result;
}
