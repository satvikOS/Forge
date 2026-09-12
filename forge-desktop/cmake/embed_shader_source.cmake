# embed_shader_source.cmake — APPEND THE SOURCE THE SPIR-V ABOVE WAS COMPILED
# FROM into the generated .spv.h, in the SAME custom command that ran glslang.
#
# ★ WHY THIS EXISTS. The .spv.h is a BUILD PRODUCT of a timestamp-driven rule.
# The rule's DEPENDS is correct and a content edit does regenerate it — MEASURED:
# editing kEdgeDepthBias and rebuilding moves the header's md5. But "the
# dependency is declared" and "the header in this build tree was produced from
# the source in this tree" are different statements, and every timestamp-driven
# build system loses the second one the moment the header is NEWER than the
# source: `touch` on the header, a `cp -p` or an rsync -t that restores a source
# with its original mtime, a clock that went backwards, a tree unpacked from an
# archive. glslang is then skipped and the binary holds the PREVIOUS shader.
#
# MEASURED, on this tree, before this file existed: set kEdgeDepthBias = 0.0 --
# the exact defect forge_desktop_render_gate was written for -- `touch` the
# generated header, rebuild, and the gate printed "36 checks, 0 failed / RENDER
# GATE PASS". The gate was not measuring the shipped shader; it was measuring a
# stale artefact of a previous one, and it could not tell.
#
# So the header carries its own provenance: the exact bytes of the source
# glslang was handed, written by the same command, next to the words it emitted.
# forge_desktop_render_gate compares them against the file on disk and goes RED
# on a mismatch. A stale header is then a FAILED GATE rather than a caveat in a
# comment that the next person to sweep the constant has to have read.
#
# Invoked as:
#   cmake -DSRC=<shader> -DHDR=<generated .spv.h> -DSYM=<C identifier> -P <this>
if(NOT DEFINED SRC OR NOT DEFINED HDR OR NOT DEFINED SYM)
    message(FATAL_ERROR "embed_shader_source.cmake needs -DSRC= -DHDR= -DSYM=")
endif()
if(NOT EXISTS "${SRC}")
    message(FATAL_ERROR "embed_shader_source.cmake: no such shader source: ${SRC}")
endif()
if(NOT EXISTS "${HDR}")
    message(FATAL_ERROR "embed_shader_source.cmake: glslang produced no header: ${HDR}")
endif()

file(READ "${SRC}" _hex HEX)
string(LENGTH "${_hex}" _hexlen)
if(_hexlen EQUAL 0)
    # An empty source would emit `[] = {};`, which is not valid C++ -- but it
    # would also mean the stamp says nothing, and a stamp that says nothing
    # compares equal to nothing. Fail the BUILD instead.
    message(FATAL_ERROR "embed_shader_source.cmake: ${SRC} is empty")
endif()
math(EXPR _bytes "${_hexlen} / 2")
string(REGEX REPLACE "(..)" "0x\\1," _arr "${_hex}")
# One line per 16 bytes, so the header stays readable. The sixteen groups are
# spelled out because CMake's regex engine has no {n} repetition -- written as
# "((0x..,){16})" this silently matches NOTHING and emits one 29 KB line, which
# is the shape of a check that quietly does nothing.
set(_g "0x..,0x..,0x..,0x..,0x..,0x..,0x..,0x..,")
string(REGEX REPLACE "(${_g}${_g})" "\\1\n    " _arr "${_arr}")

file(APPEND "${HDR}" "
// ── THE SOURCE THESE WORDS WERE COMPILED FROM ──────────────────────────────
// Appended by forge-desktop/cmake/embed_shader_source.cmake, in the SAME build
// command that ran glslangValidator on ${SRC} -- two steps of one command, so
// the words above and the text below cannot come from different builds.
//
// forge_desktop_render_gate reads that file at run time and compares it with
// this array. They differ only when the header is STALE: the binary then holds
// a shader the tree no longer contains, and every pixel the gate asserts on was
// drawn by the wrong program. That is a RED gate, not a footnote.
inline const unsigned char ${SYM}Source[] = {
    ${_arr}};
inline const unsigned long ${SYM}SourceLen = ${_bytes}ul;
")
