/***************************************************************************
 *   Copyright (c) 2023 Ondsel, Inc.                                       *
 *                                                                         *
 *   This file is part of OndselSolver.                                    *
 *                                                                         *
 *   See LICENSE file for details about copyright.                         *
 ***************************************************************************/
// SPDX-License-Identifier: LGPL-2.1-only
 
#pragma once

#include "AtPointJoint.h"

namespace MbD {
	class FixedJoint : public AtPointJoint
	{
		//
	public:
		FixedJoint();
		FixedJoint(const std::string& str);
		void initializeGlobally() override;


	};
}
