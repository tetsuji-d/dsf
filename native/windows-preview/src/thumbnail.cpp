#include "archive.hpp"
#include <shobjidl.h>
#include <thumbcache.h>
#include <new>

// Read-only, stream-initialized COM provider. Keep process isolation enabled.
const CLSID CLSID_DsfThumbnail = {0x7e47a067,0x4769,0x4cdc,{0xa9,0xa2,0x75,0xcd,0x67,0xec,0xbc,0xc1}};
static LONG objects = 0, locks = 0;
class Thumbnail final : public IThumbnailProvider, public IInitializeWithStream {
    LONG refs = 1;
    IStream* stream = nullptr;
public:
    Thumbnail() { InterlockedIncrement(&objects); }
    ~Thumbnail() { if (stream) stream->Release(); InterlockedDecrement(&objects); }
    HRESULT STDMETHODCALLTYPE QueryInterface(REFIID id, void** out) override {
        if (!out) return E_POINTER; *out = nullptr;
        if (id == __uuidof(IUnknown) || id == __uuidof(IThumbnailProvider)) *out = static_cast<IThumbnailProvider*>(this);
        else if (id == __uuidof(IInitializeWithStream)) *out = static_cast<IInitializeWithStream*>(this);
        else return E_NOINTERFACE;
        AddRef(); return S_OK;
    }
    ULONG STDMETHODCALLTYPE AddRef() override { return InterlockedIncrement(&refs); }
    ULONG STDMETHODCALLTYPE Release() override { ULONG n = InterlockedDecrement(&refs); if (!n) delete this; return n; }
    HRESULT STDMETHODCALLTYPE Initialize(IStream* input, DWORD mode) override {
        if (stream) return HRESULT_FROM_WIN32(ERROR_ALREADY_INITIALIZED);
        if (!input) return E_POINTER;
        if ((mode & 3) != STGM_READ) return STG_E_ACCESSDENIED;
        stream = input; stream->AddRef(); return S_OK;
    }
    HRESULT STDMETHODCALLTYPE GetThumbnail(UINT edge, HBITMAP* bitmap, WTS_ALPHATYPE* alpha) override {
        if (!bitmap || !alpha) return E_POINTER;
        *bitmap = nullptr; *alpha = WTSAT_UNKNOWN;
        if (!stream || !edge || edge > 1024) return E_INVALIDARG;
        try { *bitmap = dsf::renderCover(dsf::readCover(stream), edge); *alpha = WTSAT_ARGB; return S_OK; }
        catch (const std::bad_alloc&) { return E_OUTOFMEMORY; }
        catch (...) { return E_FAIL; } // Let Shell use the ordinary file icon.
    }
};
class Factory final : public IClassFactory {
    LONG refs = 1;
public:
    Factory() { InterlockedIncrement(&objects); }
    ~Factory() { InterlockedDecrement(&objects); }
    HRESULT STDMETHODCALLTYPE QueryInterface(REFIID id, void** out) override {
        if (!out) return E_POINTER; *out = nullptr;
        if (id != IID_IUnknown && id != IID_IClassFactory) return E_NOINTERFACE;
        *out = static_cast<IClassFactory*>(this); AddRef(); return S_OK;
    }
    ULONG STDMETHODCALLTYPE AddRef() override { return InterlockedIncrement(&refs); }
    ULONG STDMETHODCALLTYPE Release() override { ULONG n = InterlockedDecrement(&refs); if (!n) delete this; return n; }
    HRESULT STDMETHODCALLTYPE CreateInstance(IUnknown* outer, REFIID id, void** out) override {
        if (!out) return E_POINTER; *out = nullptr;
        if (outer) return CLASS_E_NOAGGREGATION;
        auto object = new(std::nothrow) Thumbnail(); if (!object) return E_OUTOFMEMORY;
        HRESULT hr = object->QueryInterface(id, out); object->Release(); return hr;
    }
    HRESULT STDMETHODCALLTYPE LockServer(BOOL lock) override {
        if (lock) InterlockedIncrement(&locks); else InterlockedDecrement(&locks); return S_OK;
    }
};
extern "C" HRESULT __stdcall DllGetClassObject(REFCLSID clsid, REFIID id, void** out) {
    if (!out) return E_POINTER; *out = nullptr;
    if (clsid != CLSID_DsfThumbnail) return CLASS_E_CLASSNOTAVAILABLE;
    auto factory = new(std::nothrow) Factory(); if (!factory) return E_OUTOFMEMORY;
    HRESULT hr = factory->QueryInterface(id, out); factory->Release(); return hr;
}
extern "C" HRESULT __stdcall DllCanUnloadNow() { return objects == 0 && locks == 0 ? S_OK : S_FALSE; }
