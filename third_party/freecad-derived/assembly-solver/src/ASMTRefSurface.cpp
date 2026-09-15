/***************************************************************************
 *   Copyright (c) 2023 Ondsel, Inc.                                       *
 *                                                                         *
 *   This file is part of OndselSolver.                                    *
 *                                                                         *
 *   See LICENSE file for details about copyright.                         *
 ***************************************************************************/
 
#include "ASMTRefSurface.h"
#include "CREATE.h"

using namespace MbD;

void MbD::ASMTRefSurface::parseASMT(std::vector<std::string>&)
{
	throw SimulationStoppingError("To be implemented.");
}

void MbD::ASMTRefSurface::storeOnLevel(std::ofstream&, size_t)
{
	throw SimulationStoppingError("To be implemented.");
}
