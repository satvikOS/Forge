/***************************************************************************
 *   Copyright (c) 2023 Ondsel, Inc.                                       *
 *                                                                         *
 *   This file is part of OndselSolver.                                    *
 *                                                                         *
 *   See LICENSE file for details about copyright.                         *
 ***************************************************************************/
// SPDX-License-Identifier: LGPL-2.1-only
 
#include "IndependentVariable.h"
#include "Constant.h"

using namespace MbD;

IndependentVariable::IndependentVariable()
{
}

Symsptr MbD::IndependentVariable::differentiateWRT(Symsptr var)
{
	if (this == var.get()) {
		return sptrConstant(1.0);
	}
	else {
		return sptrConstant(0.0);
	}
}
