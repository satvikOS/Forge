// This file is part of OndselSolver (Copyright (c) 2023 Ondsel, Inc.).
// The upstream file carried no notice of its own; the upstream repository's
// LICENSE applies (see ../upstream/LICENSE).
// SPDX-License-Identifier: LGPL-2.1-only
#include "ItemIJ.h"

using namespace MbD;

MbD::ItemIJ::ItemIJ()
{
}

MbD::ItemIJ::ItemIJ(const std::string& str) : Item(str)
{
}

MbD::ItemIJ::ItemIJ(EndFrmsptr frmi, EndFrmsptr frmj) : frmI(frmi), frmJ(frmj)
{
}

void MbD::ItemIJ::connectsItoJ(EndFrmsptr frmi, EndFrmsptr frmj)
{
	frmI = frmi;
	frmJ = frmj;
}
