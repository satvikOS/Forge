/***************************************************************************
 *   Copyright (c) 2023 Ondsel, Inc.                                       *
 *                                                                         *
 *   This file is part of OndselSolver.                                    *
 *                                                                         *
 *   See LICENSE file for details about copyright.                         *
 ***************************************************************************/
// SPDX-License-Identifier: LGPL-2.1-only
 
#include "ConstantGravity.h"
#include "System.h"
#include "Part.h"

using namespace MbD;

void MbD::ConstantGravity::fillAccICIterError(FColDsptr col)
{
	for (auto& part : *(root()->parts)) {
		col->atiplusFullColumntimes(part->iqX(), gXYZ, part->m);
	}
}
