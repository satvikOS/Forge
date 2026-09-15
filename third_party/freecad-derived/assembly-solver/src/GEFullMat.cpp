/***************************************************************************
 *   Copyright (c) 2023 Ondsel, Inc.                                       *
 *                                                                         *
 *   This file is part of OndselSolver.                                    *
 *                                                                         *
 *   See LICENSE file for details about copyright.                         *
 ***************************************************************************/
// SPDX-License-Identifier: LGPL-2.1-only
//
// MODIFIED for Forge (ArchDisc), 2026-09-15 -- see ../MODIFICATIONS.md.
// backSubstituteIntoDU() read one past the end of a row; fixed.

#include <cassert>

#include "GEFullMat.h"

using namespace MbD;

void GEFullMat::forwardEliminateWithPivot(size_t)
{
	throw SimulationStoppingError("To be implemented.");
}

void GEFullMat::backSubstituteIntoDU()
{
	answerX = std::make_shared<FullColumn<double>>(n);
	answerX->at(n - 1) = rightHandSideB->at(m - 1) / matrixA->at(m - 1)->at(n - 1);
	for (ssize_t i = (ssize_t)n - 2; i >= 0; i--)	//Use ssize_t because of decrement
	{
		auto rowi = matrixA->at(i);
		// Forge: upstream seeded the sum with element n (one past the end) and then
		// stopped the loop one short; this is the same sum over j = i+1 .. n-1.
		double sum = 0.0;
		for (size_t j = (size_t)i + 1; j < n; j++)
		{
			sum += answerX->at(j) * rowi->at(j);
		}
		answerX->at(i) = (rightHandSideB->at(i) - sum) / rowi->at(i);
	}
}

void GEFullMat::postSolve()
{
	throw SimulationStoppingError("To be implemented.");
}

void GEFullMat::preSolvewithsaveOriginal(FMatDsptr, FColDsptr, bool)
{
	throw SimulationStoppingError("To be implemented.");
}

void GEFullMat::preSolvewithsaveOriginal(SpMatDsptr, FColDsptr, bool)
{
	throw SimulationStoppingError("To be implemented.");
}

double GEFullMat::getmatrixArowimaxMagnitude(size_t i)
{
	return matrixA->at(i)->maxMagnitude();
}

FColDsptr GEFullMat::basicSolvewithsaveOriginal(FMatDsptr fullMat, FColDsptr fullCol, bool saveOriginal)
{
	this->preSolvewithsaveOriginal(fullMat, fullCol, saveOriginal);
	for (size_t p = 0; p < m; p++)
	{
		this->doPivoting(p);
		this->forwardEliminateWithPivot(p);
	}
	this->backSubstituteIntoDU();
	this->postSolve();
	return answerX;
}

FColDsptr GEFullMat::basicSolvewithsaveOriginal(SpMatDsptr, FColDsptr, bool)
{
	throw SimulationStoppingError("To be implemented.");
	return FColDsptr();
}
