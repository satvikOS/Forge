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
// compareResults()/outputResults() no longer print to std::cout (their reference series came from the removed .asmt reader).
#include <algorithm>
#include <fstream>	

#include "ASMTSpatialContainer.h"
#include "Units.h"
#include "Part.h"
#include "System.h"
#include "ASMTRefPoint.h"
#include "ASMTRefCurve.h"
#include "ASMTRefSurface.h"
 //#include "ASMTPrincipalMassMarker.h"


using namespace MbD;

MbD::ASMTSpatialContainer::ASMTSpatialContainer() : ASMTSpatialItem()
{
	refPoints = std::make_shared<std::vector<std::shared_ptr<ASMTRefPoint>>>();
	refCurves = std::make_shared<std::vector<std::shared_ptr<ASMTRefCurve>>>();
	refSurfaces = std::make_shared<std::vector<std::shared_ptr<ASMTRefSurface>>>();

	xs = std::make_shared<FullRow<double>>();
	ys = std::make_shared<FullRow<double>>();
	zs = std::make_shared<FullRow<double>>();
	bryxs = std::make_shared<FullRow<double>>();
	bryys = std::make_shared<FullRow<double>>();
	bryzs = std::make_shared<FullRow<double>>();
	vxs = std::make_shared<FullRow<double>>();
	vys = std::make_shared<FullRow<double>>();
	vzs = std::make_shared<FullRow<double>>();
	omexs = std::make_shared<FullRow<double>>();
	omeys = std::make_shared<FullRow<double>>();
	omezs = std::make_shared<FullRow<double>>();
	axs = std::make_shared<FullRow<double>>();
	ays = std::make_shared<FullRow<double>>();
	azs = std::make_shared<FullRow<double>>();
	alpxs = std::make_shared<FullRow<double>>();
	alpys = std::make_shared<FullRow<double>>();
	alpzs = std::make_shared<FullRow<double>>();
}

void MbD::ASMTSpatialContainer::initialize()
{
	refPoints = std::make_shared<std::vector<std::shared_ptr<ASMTRefPoint>>>();
	refCurves = std::make_shared<std::vector<std::shared_ptr<ASMTRefCurve>>>();
	refSurfaces = std::make_shared<std::vector<std::shared_ptr<ASMTRefSurface>>>();

	xs = std::make_shared<FullRow<double>>();
	ys = std::make_shared<FullRow<double>>();
	zs = std::make_shared<FullRow<double>>();
	bryxs = std::make_shared<FullRow<double>>();
	bryys = std::make_shared<FullRow<double>>();
	bryzs = std::make_shared<FullRow<double>>();
	vxs = std::make_shared<FullRow<double>>();
	vys = std::make_shared<FullRow<double>>();
	vzs = std::make_shared<FullRow<double>>();
	omexs = std::make_shared<FullRow<double>>();
	omeys = std::make_shared<FullRow<double>>();
	omezs = std::make_shared<FullRow<double>>();
	axs = std::make_shared<FullRow<double>>();
	ays = std::make_shared<FullRow<double>>();
	azs = std::make_shared<FullRow<double>>();
	alpxs = std::make_shared<FullRow<double>>();
	alpys = std::make_shared<FullRow<double>>();
	alpzs = std::make_shared<FullRow<double>>();
}

void MbD::ASMTSpatialContainer::setPrincipalMassMarker(std::shared_ptr<ASMTPrincipalMassMarker> aJ)
{
	principalMassMarker = aJ;
}

void MbD::ASMTSpatialContainer::readRefPoints(std::vector<std::string>& lines)
{
	assert(lines[0].find("RefPoints") != std::string::npos);
	lines.erase(lines.begin());
	refPoints->clear();
	auto it = std::find_if(lines.begin(), lines.end(), [](const std::string& s) {
		return s.find("RefCurves") != std::string::npos;
		});
	std::vector<std::string> refPointsLines(lines.begin(), it);
	while (!refPointsLines.empty()) {
		readRefPoint(refPointsLines);
	}
	lines.erase(lines.begin(), it);
}

void MbD::ASMTSpatialContainer::readRefPoint(std::vector<std::string>& lines)
{
	assert(lines[0].find("RefPoint") != std::string::npos);
	lines.erase(lines.begin());
	auto refPoint = CREATE<ASMTRefPoint>::With();
	refPoint->parseASMT(lines);
	refPoints->push_back(refPoint);
	refPoint->owner = this;
}

void MbD::ASMTSpatialContainer::readRefCurves(std::vector<std::string>& lines)
{
	assert(lines[0].find("RefCurves") != std::string::npos);
	lines.erase(lines.begin());
	refCurves->clear();
	auto it = std::find_if(lines.begin(), lines.end(), [](const std::string& s) {
		return s.find("RefSurfaces") != std::string::npos;
		});
	std::vector<std::string> refCurvesLines(lines.begin(), it);
	while (!refCurvesLines.empty()) {
		readRefCurve(refCurvesLines);
	}
	lines.erase(lines.begin(), it);
}

void MbD::ASMTSpatialContainer::readRefCurve(std::vector<std::string>&)
{
	throw SimulationStoppingError("To be implemented.");
}

void MbD::ASMTSpatialContainer::readRefSurfaces(std::vector<std::string>& lines)
{
	assert(lines[0].find("RefSurfaces") != std::string::npos);
	lines.erase(lines.begin());
	refSurfaces->clear();
	auto it = std::find_if(lines.begin(), lines.end(), [](const std::string& s) {
		return s.find("Part") != std::string::npos;
		});
	std::vector<std::string> refSurfacesLines(lines.begin(), it);
	while (!refSurfacesLines.empty()) {
		readRefSurface(refSurfacesLines);
	}
	lines.erase(lines.begin(), it);
}

void MbD::ASMTSpatialContainer::readRefSurface(std::vector<std::string>&)
{
	throw SimulationStoppingError("To be implemented.");
}

void MbD::ASMTSpatialContainer::readXs(std::vector<std::string>& lines)
{
	std::string str = lines[0];
	readDoublesInto(str, "X", inxs);
	lines.erase(lines.begin());
}

void MbD::ASMTSpatialContainer::readYs(std::vector<std::string>& lines)
{
	std::string str = lines[0];
	readDoublesInto(str, "Y", inys);
	lines.erase(lines.begin());
}

void MbD::ASMTSpatialContainer::readZs(std::vector<std::string>& lines)
{
	std::string str = lines[0];
	readDoublesInto(str, "Z", inzs);
	lines.erase(lines.begin());
}

void MbD::ASMTSpatialContainer::readBryantxs(std::vector<std::string>& lines)
{
	std::string str = lines[0];
	readDoublesInto(str, "Bryantx", inbryxs);
	lines.erase(lines.begin());
}

void MbD::ASMTSpatialContainer::readBryantys(std::vector<std::string>& lines)
{
	std::string str = lines[0];
	readDoublesInto(str, "Bryanty", inbryys);
	lines.erase(lines.begin());
}

void MbD::ASMTSpatialContainer::readBryantzs(std::vector<std::string>& lines)
{
	std::string str = lines[0];
	readDoublesInto(str, "Bryantz", inbryzs);
	lines.erase(lines.begin());
}

void MbD::ASMTSpatialContainer::readVXs(std::vector<std::string>& lines)
{
	std::string str = lines[0];
	readDoublesInto(str, "VX", invxs);
	lines.erase(lines.begin());
}

void MbD::ASMTSpatialContainer::readVYs(std::vector<std::string>& lines)
{
	std::string str = lines[0];
	readDoublesInto(str, "VY", invys);
	lines.erase(lines.begin());
}

void MbD::ASMTSpatialContainer::readVZs(std::vector<std::string>& lines)
{
	std::string str = lines[0];
	readDoublesInto(str, "VZ", invzs);
	lines.erase(lines.begin());
}

void MbD::ASMTSpatialContainer::readOmegaXs(std::vector<std::string>& lines)
{
	std::string str = lines[0];
	readDoublesInto(str, "OmegaX", inomexs);
	lines.erase(lines.begin());
}

void MbD::ASMTSpatialContainer::readOmegaYs(std::vector<std::string>& lines)
{
	std::string str = lines[0];
	readDoublesInto(str, "OmegaY", inomeys);
	lines.erase(lines.begin());
}

void MbD::ASMTSpatialContainer::readOmegaZs(std::vector<std::string>& lines)
{
	std::string str = lines[0];
	readDoublesInto(str, "OmegaZ", inomezs);
	lines.erase(lines.begin());
}

void MbD::ASMTSpatialContainer::readAXs(std::vector<std::string>& lines)
{
	std::string str = lines[0];
	readDoublesInto(str, "AX", inaxs);
	lines.erase(lines.begin());
}

void MbD::ASMTSpatialContainer::readAYs(std::vector<std::string>& lines)
{
	std::string str = lines[0];
	readDoublesInto(str, "AY", inays);
	lines.erase(lines.begin());
}

void MbD::ASMTSpatialContainer::readAZs(std::vector<std::string>& lines)
{
	std::string str = lines[0];
	readDoublesInto(str, "AZ", inazs);
	lines.erase(lines.begin());
}

void MbD::ASMTSpatialContainer::readAlphaXs(std::vector<std::string>& lines)
{
	std::string str = lines[0];
	readDoublesInto(str, "AlphaX", inalpxs);
	lines.erase(lines.begin());
}

void MbD::ASMTSpatialContainer::readAlphaYs(std::vector<std::string>& lines)
{
	std::string str = lines[0];
	readDoublesInto(str, "AlphaY", inalpys);
	lines.erase(lines.begin());
}

void MbD::ASMTSpatialContainer::readAlphaZs(std::vector<std::string>& lines)
{
	std::string str = lines[0];
	readDoublesInto(str, "AlphaZ", inalpzs);
	lines.erase(lines.begin());
}

void MbD::ASMTSpatialContainer::createMbD(std::shared_ptr<System> mbdSys, std::shared_ptr<Units> mbdUnits)
{
	auto mbdPart = CREATE<Part>::With();
	mbdObject = mbdPart;
	mbdPart->name = fullName("");
	mbdPart->m = principalMassMarker->mass / mbdUnits->mass;
	mbdPart->aJ = principalMassMarker->momentOfInertias->times(1.0 / mbdUnits->aJ);
	mbdPart->qX(rOcmO()->times(1.0 / mbdUnits->length));
	mbdPart->qE(qEp());
	mbdPart->qXdot(vOcmO()->times(1.0 / mbdUnits->velocity));
	mbdPart->omeOpO(omeOpO()->times(1.0 / mbdUnits->omega));
	mbdPart->qXddot(std::make_shared<FullColumn<double>>(3, 0));
	mbdPart->qEddot(std::make_shared<FullColumn<double>>(4, 0));
	mbdSys->addPart(mbdPart);
	for (auto& refPoint : *refPoints) {
		refPoint->createMbD(mbdSys, mbdUnits);
	}
	for (auto& refCurve : *refCurves) {
		refCurve->createMbD(mbdSys, mbdUnits);
	}
	for (auto& refSurface : *refSurfaces) {
		refSurface->createMbD(mbdSys, mbdUnits);
	}
}

void MbD::ASMTSpatialContainer::updateMbDFromPosition3D(FColDsptr vec)
{
	position3D = vec;
	auto mbdPart = std::static_pointer_cast<Part>(mbdObject);
	auto mbdUnits = this->mbdUnits();
	mbdPart->qX(rOcmO()->times(1.0 / mbdUnits->length));
}

void MbD::ASMTSpatialContainer::updateMbDFromPosition3D(double a, double b, double c)
{
	auto pos3D = std::make_shared<FullColumn<double>>(ListD{ a, b, c });
	updateMbDFromPosition3D(pos3D);
}

void MbD::ASMTSpatialContainer::updateMbDFromRotationMatrix(FMatDsptr mat)
{
	rotationMatrix = mat;
	auto mbdPart = std::static_pointer_cast<Part>(mbdObject);
	auto mbdUnits = this->mbdUnits();
	mbdPart->qX(rOcmO()->times(1.0 / mbdUnits->length));
	mbdPart->qE(qEp());
}

void MbD::ASMTSpatialContainer::updateMbDFromRotationMatrix(double v11, double v12, double v13, double v21, double v22, double v23, double v31, double v32, double v33)
{
	auto rotMat = std::make_shared<FullMatrix<double>>(ListListD{
		{ v11, v12, v13 },
		{ v21, v22, v23 },
		{ v31, v32, v33 }
		});
	updateMbDFromRotationMatrix(rotMat);
}

FColDsptr MbD::ASMTSpatialContainer::rOcmO()
{
	auto& rOPO = position3D;
	auto& aAOP = rotationMatrix;
	auto& rPcmP = principalMassMarker->position3D;
	auto rOcmO = rOPO->plusFullColumn(aAOP->timesFullColumn(rPcmP));
	return rOcmO;
}

std::shared_ptr<EulerParameters<double>> MbD::ASMTSpatialContainer::qEp()
{
	auto& aAOP = rotationMatrix;
	auto& aAPcm = principalMassMarker->rotationMatrix;
	auto aAOcm = aAOP->timesFullMatrix(aAPcm);
	return aAOcm->asEulerParameters();
}

FColDsptr MbD::ASMTSpatialContainer::vOcmO()
{
	throw SimulationStoppingError("To be implemented.");
	return FColDsptr();
}

FColDsptr MbD::ASMTSpatialContainer::omeOpO()
{
	throw SimulationStoppingError("To be implemented.");
	return FColDsptr();
}

ASMTSpatialContainer* MbD::ASMTSpatialContainer::partOrAssembly()
{
	return this;
}

void MbD::ASMTSpatialContainer::updateForFrame(size_t index)
{
    position3D = getPosition3D(index);
    rotationMatrix = getRotationMatrix(index);
    velocity3D = getVelocity3D(index);
    omega3D = getOmega3D(index);
    acceleration3D = getAcceleration3D(index);
    alpha3D = getAlpha3D(index);
}

void MbD::ASMTSpatialContainer::updateFromInitiallyAssembledState()
{

}

void MbD::ASMTSpatialContainer::updateFromInputState()
{

}

void MbD::ASMTSpatialContainer::updateFromMbD()
{
	auto mbdUnts = mbdUnits();
	auto mbdPart = std::static_pointer_cast<Part>(mbdObject);
	auto rOcmO = mbdPart->qX()->times(mbdUnts->length);
	auto aAOp = mbdPart->aAOp();
	//std::cout << "aAOp" << *aAOp << std::endl;
	auto vOcmO = mbdPart->qXdot()->times(mbdUnts->velocity);
	auto omeOPO = mbdPart->omeOpO()->times(mbdUnts->omega);
	omega3D = omeOPO;
	auto aOcmO = mbdPart->qXddot()->times(mbdUnts->acceleration);
	auto alpOPO = mbdPart->alpOpO()->times(mbdUnts->alpha);
    alpha3D = alpOPO;
	auto& rPcmP = principalMassMarker->position3D;
	auto& aAPp = principalMassMarker->rotationMatrix;
	auto aAOP = aAOp->timesTransposeFullMatrix(aAPp);
	rotationMatrix = aAOP;
	oldRotMat = rotationMatrix;
	auto rPcmO = aAOP->timesFullColumn(rPcmP);
	auto rOPO = rOcmO->minusFullColumn(rPcmO);
	position3D = rOPO;
	oldPos3D = position3D;
	auto vOPO = vOcmO->minusFullColumn(omeOPO->cross(rPcmO));
	velocity3D = vOPO;
	auto aOPO = aOcmO->minusFullColumn(alpOPO->cross(rPcmO))->minusFullColumn(omeOPO->cross(omeOPO->cross(rPcmO)));
    acceleration3D = aOPO;
    xs->push_back(rOPO->at(0));
	ys->push_back(rOPO->at(1));
	zs->push_back(rOPO->at(2));
	auto bryantAngles = aAOP->bryantAngles();
	bryxs->push_back(bryantAngles->at(0));
	bryys->push_back(bryantAngles->at(1));
	bryzs->push_back(bryantAngles->at(2));
	//std::cout << "bry " << *bryantAngles << std::endl;
	vxs->push_back(vOPO->at(0));
	vys->push_back(vOPO->at(1));
	vzs->push_back(vOPO->at(2));
	omexs->push_back(omeOPO->at(0));
	omeys->push_back(omeOPO->at(1));
	omezs->push_back(omeOPO->at(2));
	axs->push_back(aOPO->at(0));
	ays->push_back(aOPO->at(1));
	azs->push_back(aOPO->at(2));
	alpxs->push_back(alpOPO->at(0));
	alpys->push_back(alpOPO->at(1));
	alpzs->push_back(alpOPO->at(2));
}

void MbD::ASMTSpatialContainer::compareResults(AnalysisType)
{
	// Forge: the reference series this compared against came from an .asmt file,
	// and the file reader is removed. Nothing to compare; nothing is printed.
}

void MbD::ASMTSpatialContainer::outputResults(AnalysisType)
{
	// Forge: results are read back through the host, never printed.
}

void MbD::ASMTSpatialContainer::addRefPoint(std::shared_ptr<ASMTRefPoint> refPoint)
{
	refPoints->push_back(refPoint);
	refPoint->owner = this;
}

void MbD::ASMTSpatialContainer::addMarker(std::shared_ptr<ASMTMarker> marker)
{
	auto refPoint = CREATE<ASMTRefPoint>::With();
	addRefPoint(refPoint);
	refPoint->addMarker(marker);
}

std::string MbD::ASMTSpatialContainer::generateUniqueMarkerName()
{
	auto aItemList = markerList();
	auto markerNames = std::vector<std::string>();
	for (auto& mkr : *aItemList) {
		markerNames.push_back(mkr->name);
	}
	std::stringstream ss;
	auto count = 0;
	while (true) {
		ss.str("");
		ss << "Marker";
		ss << count;
		if (std::find(markerNames.begin(), markerNames.end(), ss.str()) == markerNames.end()) break;
		count++;
	}
	return ss.str();
}

std::shared_ptr<std::vector<std::shared_ptr<ASMTMarker>>> MbD::ASMTSpatialContainer::markerList()
{
	auto markers = std::make_shared<std::vector<std::shared_ptr<ASMTMarker>>>();
	for (auto& refPoint : *refPoints) {
		auto refmarkers = refPoint->markers;
		markers->insert(markers->end(), refmarkers->begin(), refmarkers->end());
	}
	return markers;
}

void MbD::ASMTSpatialContainer::storeOnLevel(std::ofstream& os, size_t level)
{
	ASMTSpatialItem::storeOnLevel(os, level);
	storeOnLevelVelocity(os, level + 1);
	storeOnLevelOmega(os, level + 1);
	storeOnLevelRefPoints(os, level + 1);
	storeOnLevelRefCurves(os, level + 1);
	storeOnLevelRefSurfaces(os, level + 1);
}

void MbD::ASMTSpatialContainer::setVelocity3D(FColDsptr vec)
{
	velocity3D = vec;
}

void MbD::ASMTSpatialContainer::setOmega3D(FColDsptr vec)
{
	omega3D = vec;
}

void MbD::ASMTSpatialContainer::readVelocity3D(std::vector<std::string>& lines)
{
	assert(lines[0].find("Velocity3D") != std::string::npos);
	lines.erase(lines.begin());
	std::istringstream iss(lines[0]);
	velocity3D = std::make_shared<FullColumn<double>>();
	double d;
	while (iss >> d) {
		velocity3D->push_back(d);
	}
	lines.erase(lines.begin());
}

void MbD::ASMTSpatialContainer::readOmega3D(std::vector<std::string>& lines)
{
	assert(lines[0].find("Omega3D") != std::string::npos);
	lines.erase(lines.begin());
	std::istringstream iss(lines[0]);
	omega3D = std::make_shared<FullColumn<double>>();
	double d;
	while (iss >> d) {
		omega3D->push_back(d);
	}
	lines.erase(lines.begin());
}

void MbD::ASMTSpatialContainer::setVelocity3D(double a, double b, double c)
{
	velocity3D = std::make_shared<FullColumn<double>>(ListD{ a, b, c });
}

void MbD::ASMTSpatialContainer::setOmega3D(double a, double b, double c)
{
	omega3D = std::make_shared<FullColumn<double>>(ListD{ a, b, c });
}

void MbD::ASMTSpatialContainer::storeOnLevelVelocity(std::ofstream& os, size_t level)
{
	storeOnLevelString(os, level, "Velocity3D");
	if (vxs == nullptr || vxs->empty()) {
		storeOnLevelArray(os, level + 1, *velocity3D);
	}
	else {
		auto array = getVelocity3D(0);
		storeOnLevelArray(os, level + 1, *array);
	}
}

void MbD::ASMTSpatialContainer::storeOnLevelOmega(std::ofstream& os, size_t level)
{
	storeOnLevelString(os, level, "Omega3D");
	if (omexs == nullptr || omexs->empty()) {
		storeOnLevelArray(os, level + 1, *omega3D);
	}
	else {
		auto array = getOmega3D(0);
		storeOnLevelArray(os, level + 1, *array);
	}
}

void MbD::ASMTSpatialContainer::storeOnLevelRefPoints(std::ofstream& os, size_t level)
{
	storeOnLevelString(os, level, "RefPoints");
	for (auto& refPoint : *refPoints)
	{
		refPoint->storeOnLevel(os, level + 1);
	}
}

void MbD::ASMTSpatialContainer::storeOnLevelRefCurves(std::ofstream& os, size_t level)
{
	storeOnLevelString(os, level, "RefCurves");
	for (auto& refCurve : *refCurves)
	{
		refCurve->storeOnLevel(os, level);
	}
}

void MbD::ASMTSpatialContainer::storeOnLevelRefSurfaces(std::ofstream& os, size_t level)
{
	storeOnLevelString(os, level, "RefSurfaces");
	for (auto& refSurface : *refSurfaces)
	{
		refSurface->storeOnLevel(os, level);
	}
}

void MbD::ASMTSpatialContainer::storeOnTimeSeries(std::ofstream& os)
{
	os << "X\t";
	for (size_t i = 0; i < xs->size(); i++)
	{
		os << xs->at(i) << '\t';
	}
	os << std::endl;
	os << "Y\t";
	for (size_t i = 0; i < ys->size(); i++)
	{
		os << ys->at(i) << '\t';
	}
	os << std::endl;
	os << "Z\t";
	for (size_t i = 0; i < zs->size(); i++)
	{
		os << zs->at(i) << '\t';
	}
	os << std::endl;
	os << "Bryantx\t";
	for (size_t i = 0; i < bryxs->size(); i++)
	{
		os << bryxs->at(i) << '\t';
	}
	os << std::endl;
	os << "Bryanty\t";
	for (size_t i = 0; i < bryys->size(); i++)
	{
		os << bryys->at(i) << '\t';
	}
	os << std::endl;
	os << "Bryantz\t";
	for (size_t i = 0; i < bryzs->size(); i++)
	{
		os << bryzs->at(i) << '\t';
	}
	os << std::endl;
	os << "VX\t";
	for (size_t i = 0; i < vxs->size(); i++)
	{
		os << vxs->at(i) << '\t';
	}
	os << std::endl;
	os << "VY\t";
	for (size_t i = 0; i < vys->size(); i++)
	{
		os << vys->at(i) << '\t';
	}
	os << std::endl;
	os << "VZ\t";
	for (size_t i = 0; i < vzs->size(); i++)
	{
		os << vzs->at(i) << '\t';
	}
	os << std::endl;
	os << "OmegaX\t";
	for (size_t i = 0; i < omexs->size(); i++)
	{
		os << omexs->at(i) << '\t';
	}
	os << std::endl;
	os << "OmegaY\t";
	for (size_t i = 0; i < omeys->size(); i++)
	{
		os << omeys->at(i) << '\t';
	}
	os << std::endl;
	os << "OmegaZ\t";
	for (size_t i = 0; i < omezs->size(); i++)
	{
		os << omezs->at(i) << '\t';
	}
	os << std::endl;
	os << "AX\t";
	for (size_t i = 0; i < axs->size(); i++)
	{
		os << axs->at(i) << '\t';
	}
	os << std::endl;
	os << "AY\t";
	for (size_t i = 0; i < ays->size(); i++)
	{
		os << ays->at(i) << '\t';
	}
	os << std::endl;
	os << "AZ\t";
	for (size_t i = 0; i < azs->size(); i++)
	{
		os << azs->at(i) << '\t';
	}
	os << std::endl;
	os << "AlphaX\t";
	for (size_t i = 0; i < alpxs->size(); i++)
	{
		os << alpxs->at(i) << '\t';
	}
	os << std::endl;
	os << "AlphaY\t";
	for (size_t i = 0; i < alpys->size(); i++)
	{
		os << alpys->at(i) << '\t';
	}
	os << std::endl;
	os << "AlphaZ\t";
	for (size_t i = 0; i < alpzs->size(); i++)
	{
		os << alpzs->at(i) << '\t';
	}
	os << std::endl;
}

FColDsptr MbD::ASMTSpatialContainer::getVelocity3D(size_t i)
{
	auto vec3 = std::make_shared<FullColumn<double>>(3);
	vec3->atiput(0, vxs->at(i));
	vec3->atiput(1, vys->at(i));
	vec3->atiput(2, vzs->at(i));
	return vec3;
}

FColDsptr MbD::ASMTSpatialContainer::getOmega3D(size_t i)
{
	auto vec3 = std::make_shared<FullColumn<double>>(3);
	vec3->atiput(0, omexs->at(i));
	vec3->atiput(1, omeys->at(i));
	vec3->atiput(2, omezs->at(i));
	return vec3;
}

FColDsptr MbD::ASMTSpatialContainer::getAcceleration3D(size_t i)
{
    auto vec3 = std::make_shared<FullColumn<double>>(3);
    vec3->atiput(0, axs->at(i));
    vec3->atiput(1, ays->at(i));
    vec3->atiput(2, azs->at(i));
    return vec3;
}

FColDsptr MbD::ASMTSpatialContainer::getAlpha3D(size_t i)
{
    auto vec3 = std::make_shared<FullColumn<double>>(3);
    vec3->atiput(0, alpxs->at(i));
    vec3->atiput(1, alpys->at(i));
    vec3->atiput(2, alpzs->at(i));
    return vec3;
}
