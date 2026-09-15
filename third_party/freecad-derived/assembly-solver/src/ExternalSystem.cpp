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
// Only the ASMT assembly back-end remains; a missing host is a refusal
// (SimulationStoppingError) rather than a dereference of an unset pointer.
// logString() records into `messages` (bounded) instead of std::cout.

#include "ExternalSystem.h"
#include "ASMTAssembly.h"
#include "System.h"
#include "SimulationStoppingError.h"

using namespace MbD;

namespace {
// Enough to diagnose a failed solve, small enough that a pathological loop
// cannot grow the host's memory without bound.
constexpr std::size_t kMaxSolverMessages = 256;
}

void MbD::ExternalSystem::preMbDrun(std::shared_ptr<System> mbdSys)
{
    if (!asmtAssembly) {
        throw SimulationStoppingError("no assembly is attached to the solver");
    }
    asmtAssembly->preMbDrun(mbdSys);
}

void MbD::ExternalSystem::preMbDrunDragStep(std::shared_ptr<System> mbdSys, std::shared_ptr<std::vector<std::shared_ptr<Part>>> dragParts)
{
    if (!asmtAssembly) {
        throw SimulationStoppingError("no assembly is attached to the solver");
    }
	asmtAssembly->preMbDrunDragStep(mbdSys, dragParts);
}

void MbD::ExternalSystem::updateFromMbD()
{
    if (!asmtAssembly) {
        throw SimulationStoppingError("no assembly is attached to the solver");
    }
    asmtAssembly->updateFromMbD();
}

void MbD::ExternalSystem::outputFor(AnalysisType type)
{
    if (!asmtAssembly) {
        throw SimulationStoppingError("no assembly is attached to the solver");
    }
    asmtAssembly->updateFromMbD();
    asmtAssembly->compareResults(type);
    asmtAssembly->outputResults(type);
}

void MbD::ExternalSystem::logString(const std::string& str)
{
	if (messages && messages->size() < kMaxSolverMessages) {
		messages->push_back(str);
	}
}

void MbD::ExternalSystem::logString(double value)
{
	logString(std::to_string(value));
}

void MbD::ExternalSystem::postMbDrun()
{
	//Do nothing
}
