/***************************************************************************
 *   Copyright (c) 2023 Ondsel, Inc.                                       *
 *                                                                         *
 *   This file is part of OndselSolver.                                    *
 *                                                                         *
 *   See LICENSE file for details about copyright.                         *
 ***************************************************************************/
// SPDX-License-Identifier: LGPL-2.1-only
 
#include "AccICNewtonRaphson.h"
#include "SystemSolver.h"

using namespace MbD;

bool AccICNewtonRaphson::isConverged()
{
	return this->isConvergedToNumericalLimit();
}

void AccICNewtonRaphson::preRun()
{
	std::string str("MbD: Solving for acceleration initial conditions.");
	system->logString(str);
	AccNewtonRaphson::preRun();
}
