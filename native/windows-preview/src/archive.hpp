#pragma once
#include <windows.h>
#include <objidl.h>
#include <vector>
#include <string>

namespace dsf {
struct Cover { std::vector<unsigned char> bytes; std::string path; };
// Existing archives are read through the supplied stream; no disk extraction.
Cover readCover(IStream* stream);
HBITMAP renderCover(const Cover& cover, unsigned edge);
void writePng(HBITMAP bitmap, const wchar_t* path);
}
