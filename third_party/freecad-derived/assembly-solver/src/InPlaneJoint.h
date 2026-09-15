/***************************************************************************
 *   Copyright (c) 2023 Ondsel, Inc.                                       *
 *                                                                         *
 *   This file is part of OndselSolver.                                    *
 *                                                                         *
 *   See LICENSE file for details about copyright.                         *
 ***************************************************************************/
// SPDX-License-Identifier: LGPL-2.1-only
 
#pragma once

#include "Joint.h"

namespace MbD {
	class InPlaneJoint : public Joint
	{
		//offset
	public:
		InPlaneJoint();
		InPlaneJoint(const std::string& str);
		virtual void initializeGlobally() = 0;	//To prevent instantiation of this class

		void createInPlaneConstraint();

		double offset = 0.0;
	};
}

