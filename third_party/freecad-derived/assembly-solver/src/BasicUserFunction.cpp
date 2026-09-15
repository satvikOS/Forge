/***************************************************************************
 *   Copyright (c) 2023 Ondsel, Inc.                                       *
 *                                                                         *
 *   This file is part of OndselSolver.                                    *
 *                                                                         *
 *   See LICENSE file for details about copyright.                         *
 ***************************************************************************/
// SPDX-License-Identifier: LGPL-2.1-only
 
#include "BasicUserFunction.h"
#include "CREATE.h"
#include "Units.h"

using namespace MbD;

MbD::BasicUserFunction::BasicUserFunction(const std::string& expression, double myUnt) : funcText(expression), myUnit(myUnt)
{
	units = std::make_shared<Units>();
}

void MbD::BasicUserFunction::initialize()
{
	units = CREATE<Units>::With();
}
