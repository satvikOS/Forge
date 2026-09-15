/***************************************************************************
 *   Copyright (c) 2023 Ondsel, Inc.                                       *
 *                                                                         *
 *   This file is part of OndselSolver.                                    *
 *                                                                         *
 *   See LICENSE file for details about copyright.                         *
 ***************************************************************************/
// SPDX-License-Identifier: LGPL-2.1-only
 
#pragma once

#include "Item.h"

namespace MbD {
	class CartesianFrame : public Item
	{
	public:
		CartesianFrame();
		CartesianFrame(const std::string& str);
		void initialize() override;
	};
}

