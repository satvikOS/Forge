/* SPDX-License-Identifier: LGPL-2.1-or-later */
/***************************************************************************
 *   Copyright (c) 2026 ArchDisc                                           *
 *                                                                         *
 *   This file is part of the Forge build of the FreeCAD material library  *
 *   (third_party/freecad-derived/materials). The material cards and model *
 *   definitions it serves are FreeCAD's, by their named authors; see     *
 *   README.md and component.json beside it.                               *
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

/*
 * The whole interface of libforge_fcmaterials: a read-only list of files.
 *
 * The library carries FreeCAD's material cards (.FCMat) and the model
 * definitions (.yml) those cards name, byte for byte as FreeCAD ships them, and
 * hands them out by index. It interprets NOTHING. Parsing, unit checking and
 * everything a material does inside Forge happen in the application, which is
 * why this interface is plain C with no Forge type in it: a user who edits a
 * card, or replaces the whole card set, rebuilds this one library and the
 * unmodified application picks the change up at its next launch.
 *
 * Paths are relative to FreeCAD's src/Mod/Material/ and always begin
 * "Resources/Materials/" (a card) or "Resources/Models/" (a model definition).
 * Every pointer handed out is to static storage owned by the library and valid
 * for the life of the process. The bytes are exactly the file's bytes (a card
 * may begin with a UTF-8 byte-order mark); a NUL follows the last byte but is not
 * counted in `size`.
 */
#ifndef FORGE_FCMAT_BUNDLE_H
#define FORGE_FCMAT_BUNDLE_H

#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

#if defined(_WIN32)
#  define FORGE_FCMAT_API __declspec(dllexport)
#else
#  define FORGE_FCMAT_API __attribute__((visibility("default")))
#endif

/* Bumped whenever a function below changes meaning. A caller built against a
 * different number must refuse the library rather than guess. */
#define FORGE_FCMAT_ABI_VERSION 1u

typedef struct forge_fcmat_file {
  const char* path;  /* "Resources/Materials/Standard/Metal/Steel/Steel-S235JR.FCMat" */
  const char* bytes; /* the file's contents, NUL-terminated for convenience          */
  size_t size;       /* byte count, excluding the terminating NUL                     */
} forge_fcmat_file;

/* FORGE_FCMAT_ABI_VERSION as this library was built. */
FORGE_FCMAT_API unsigned forge_fcmat_abi_version(void);

/* The FreeCAD commit the files were taken from, 40 hex digits. */
FORGE_FCMAT_API const char* forge_fcmat_upstream_commit(void);

/* How many files the library carries. */
FORGE_FCMAT_API size_t forge_fcmat_file_count(void);

/* Fills `out` with file `index`. Returns 0 on success, -1 when `index` is out of
 * range or `out` is NULL (and leaves `out` untouched). */
FORGE_FCMAT_API int forge_fcmat_file_at(size_t index, forge_fcmat_file* out);

#ifdef __cplusplus
}
#endif

#endif /* FORGE_FCMAT_BUNDLE_H */
