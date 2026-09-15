/***************************************************************************
 *   Copyright (c) 2023 Ondsel, Inc.                                       *
 *                                                                         *
 *   This file is part of OndselSolver.                                    *
 *                                                                         *
 *   See LICENSE file for details about copyright.                         *
 ***************************************************************************/
// SPDX-License-Identifier: LGPL-2.1-only
//
// MODIFIED for Forge (ArchDisc), 2026-09-15 -- see ../MODIFICATIONS.md.
// The CADSystem demo back-end and the FreeCAD AssemblyObject back-pointer are
// removed; the ASMT assembly is the only host. logString() no longer writes to
// std::cout: it appends to a bounded message list the host installs.

#pragma once

#include <memory>
#include <string>
#include <vector>
#include "enum.h"

#include "Part.h"

namespace MbD {
	class ASMTAssembly;
    class System;

	class ExternalSystem
	{
		//
	public:
		void preMbDrun(std::shared_ptr<System> mbdSys);
		void preMbDrunDragStep(std::shared_ptr<System> mbdSys, std::shared_ptr<std::vector<std::shared_ptr<Part>>> dragParts);
		void updateFromMbD();
		void outputFor(AnalysisType type);
		void logString(const std::string& str);
		void logString(double value);
		void postMbDrun();

        ASMTAssembly* asmtAssembly = nullptr;
		// Where solver progress messages go. Null means they are discarded. A
		// library must not write to a process's standard streams: Forge's kernel
		// worker speaks a protocol on stdout.
		std::shared_ptr<std::vector<std::string>> messages;
	};
}

