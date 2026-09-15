/***************************************************************************
 *   Copyright (c) 2023 Ondsel, Inc.                                       *
 *                                                                         *
 *   This file is part of OndselSolver.                                    *
 *                                                                         *
 *   See LICENSE file for details about copyright.                         *
 ***************************************************************************/
// SPDX-License-Identifier: LGPL-2.1-only
 
#pragma once

#include <stdexcept>
#include <memory>
#include <vector>

namespace MbD {
	class NewtonRaphsonError : virtual public std::runtime_error
	{

	public:
		//NewtonRaphsonError();
		explicit NewtonRaphsonError(const std::string& msg);
		virtual ~NewtonRaphsonError() noexcept {}
	};
}
