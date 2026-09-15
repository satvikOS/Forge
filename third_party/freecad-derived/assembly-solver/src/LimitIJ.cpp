// This file is part of OndselSolver (Copyright (c) 2023 Ondsel, Inc.).
// The upstream file carried no notice of its own; the upstream repository's
// LICENSE applies (see ../upstream/LICENSE).
// SPDX-License-Identifier: LGPL-2.1-only
#include "LimitIJ.h"
#include "Constraint.h"

using namespace MbD;

bool MbD::LimitIJ::satisfied() const
{
	auto& constraint = constraints->front();
	if (type == "=<") {
		return constraint->aG < tol;
	}
	else if (type == "=>") {
		return constraint->aG > -tol;
	}
	throw SimulationStoppingError("To be implemented.");
	return true;
}

void MbD::LimitIJ::deactivate()
{
	active = false;
}

void MbD::LimitIJ::activate()
{
	active = true;
}

void MbD::LimitIJ::fillConstraints(std::shared_ptr<std::vector<std::shared_ptr<Constraint>>> allConstraints)
{
	if (active) {
		ConstraintSet::fillConstraints(allConstraints);
	}
}

void MbD::LimitIJ::fillPosICError(FColDsptr col)
{
	if (active) {
		ConstraintSet::fillPosICError(col);
	}
}

void MbD::LimitIJ::fillPosICJacob(SpMatDsptr mat)
{
	if (active) {
		ConstraintSet::fillPosICJacob(mat);
	}
}

void MbD::LimitIJ::fillqsulam(FColDsptr col)
{
	if (active) {
		ConstraintSet::fillqsulam(col);
	}
}

void MbD::LimitIJ::setqsulam(FColDsptr col)
{
	if (active) {
		ConstraintSet::setqsulam(col);
	}
}

void MbD::LimitIJ::useEquationNumbers()
{
	if (active) {
		ConstraintSet::useEquationNumbers();
	}
}
