/***************************************************************************
 *   Copyright (c) 2023 Ondsel, Inc.                                       *
 *                                                                         *
 *   This file is part of OndselSolver.                                    *
 *                                                                         *
 *   See LICENSE file for details about copyright.                         *
 ***************************************************************************/
// SPDX-License-Identifier: LGPL-2.1-only
 
#include "AccKineNewtonRaphson.h"
#include "SystemSolver.h"

using namespace MbD;

void AccKineNewtonRaphson::initializeGlobally()
{
	AccNewtonRaphson::initializeGlobally();
	iterMax = system->iterMaxAccKine;
	dxTol = system->errorTolAccKine;
}

void AccKineNewtonRaphson::preRun()
{
	std::string str("MbD: Solving for kinematic acceleration.");
	system->logString(str);
	AccNewtonRaphson::preRun();
}
