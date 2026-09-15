// SPDX-License-Identifier: LGPL-2.1-or-later
/***************************************************************************
 *   Copyright (c) 2026 ArchDisc                                           *
 *                                                                         *
 *   This file is part of the Forge build of the FreeCAD material library  *
 *   (third_party/freecad-derived/materials).                              *
 *                                                                         *
 *   This library is free software; you can redistribute it and/or modify *
 *   it under the terms of the GNU Lesser General Public License as        *
 *   published by the Free Software Foundation, either version 2.1 of the  *
 *   License, or (at your option) any later version.                       *
 *                                                                         *
 *   This library is distributed in the hope that it will be useful, but  *
 *   WITHOUT ANY WARRANTY; without even the implied warranty of            *
 *   MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU      *
 *   Lesser General Public License for more details (COPYING.LGPL).        *
 ***************************************************************************/

#include "forge_fcmat/fcmat_bundle.h"

#include "fcmat_resources.inc"  // generated at build time from Resources/ by cmake/embed_resources.cmake

extern "C" {

unsigned forge_fcmat_abi_version(void) { return FORGE_FCMAT_ABI_VERSION; }

const char* forge_fcmat_upstream_commit(void) { return kFcmatUpstreamCommit; }

size_t forge_fcmat_file_count(void) { return sizeof(kFcmatFiles) / sizeof(kFcmatFiles[0]); }

int forge_fcmat_file_at(size_t index, forge_fcmat_file* out) {
  if (out == nullptr || index >= forge_fcmat_file_count()) return -1;
  out->path = kFcmatFiles[index].path;
  out->bytes = kFcmatFiles[index].bytes;
  out->size = kFcmatFiles[index].size;
  return 0;
}

}  // extern "C"
