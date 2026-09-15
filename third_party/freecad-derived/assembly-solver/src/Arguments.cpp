/***************************************************************************
 *   Copyright (c) 2023 Ondsel, Inc.                                       *
 *                                                                         *
 *   This file is part of OndselSolver.                                    *
 *                                                                         *
 *   See LICENSE file for details about copyright.                         *
 ***************************************************************************/
// SPDX-License-Identifier: LGPL-2.1-only

#include <algorithm>
#include <iterator>

#include "Arguments.h"

using namespace MbD;


void MbD::Arguments::arguments(Symsptr args)
{
	auto arguments = std::static_pointer_cast<Arguments>(args);
	terms = arguments->terms;
}
