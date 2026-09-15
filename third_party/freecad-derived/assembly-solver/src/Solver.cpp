/***************************************************************************
 *   Copyright (c) 2023 Ondsel, Inc.                                       *
 *                                                                         *
 *   This file is part of OndselSolver.                                    *
 *                                                                         *
 *   See LICENSE file for details about copyright.                         *
 ***************************************************************************/
 
#include <assert.h>

#include "Solver.h"
#include <string>
#include "SimulationStoppingError.h"

using namespace MbD;

void MbD::Solver::noop()
{
	//No Operations
}

void Solver::initialize()
{
}

void Solver::initializeLocally()
{
}

void Solver::initializeGlobally()
{
	throw SimulationStoppingError("To be implemented.");
}

void Solver::assignEquationNumbers()
{
	throw SimulationStoppingError("To be implemented.");
}

void Solver::run()
{
	throw SimulationStoppingError("To be implemented.");
}

void Solver::preRun()
{
	throw SimulationStoppingError("To be implemented.");
}

void Solver::finalize()
{
}

void Solver::reportStats()
{
}

void Solver::postRun()
{
	throw SimulationStoppingError("To be implemented.");
}

void Solver::logString(const std::string&)
{
	throw SimulationStoppingError("To be implemented.");
}

void MbD::Solver::handleSingularMatrix()
{
	throw SimulationStoppingError("To be implemented.");
}
