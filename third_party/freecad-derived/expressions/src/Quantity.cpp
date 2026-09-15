// SPDX-License-Identifier: LGPL-2.1-or-later

/***************************************************************************
 *   Copyright (c) 2013 Jürgen Riegel <juergen.riegel@web.de>              *
 *                                                                         *
 *   This file is part of the FreeCAD CAx development system.              *
 *                                                                         *
 *   This library is free software; you can redistribute it and/or         *
 *   modify it under the terms of the GNU Library General Public           *
 *   License as published by the Free Software Foundation; either          *
 *   version 2 of the License, or (at your option) any later version.      *
 *                                                                         *
 *   This library  is distributed in the hope that it will be useful,      *
 *   but WITHOUT ANY WARRANTY; without even the implied warranty of        *
 *   MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the         *
 *   GNU Library General Public License for more details.                  *
 *                                                                         *
 *   You should have received a copy of the GNU Library General Public     *
 *   License along with this library; see the file COPYING.LIB. If not,    *
 *   write to the Free Software Foundation, Inc., 59 Temple Place,         *
 *   Suite 330, Boston, MA  02111-1307, USA                                *
 *                                                                         *
 ***************************************************************************/

// MODIFIED for libforge_expr (2026-09-15) from FreeCAD src/Base/Quantity.cpp at
// commit 0a45a0a008d4af7a85601016c5ab31bd26c25b22. See MODIFICATIONS.md:
//   * namespace Base -> forge::expr
//   * QuantityFormat, UnitsApi/UnitsSchema user strings, the {fmt} dependency and
//     the separate flex/bison Quantity parser (Quantity.y / Quantity.l) are removed
//   * pow(const Quantity&) applies the exponent to the unit as a double, so a
//     non-integral power of a dimensioned quantity is REFUSED by Unit::pow()
//     instead of silently dropping the unit (upstream cast the exponent to
//     signed char first: (4 mm^2)^0.5 came out as the dimensionless number 2)
//   * the predefined quantities are upstream's, value for value

#include <array>
#include <cmath>
#include <iomanip>
#include <limits>
#include <numbers>
#include <sstream>
#include <string>

#include "forge_expr/Exception.h"
#include "forge_expr/Quantity.h"
#include "UnitsConvData.h"

using forge::expr::Quantity;
using forge::expr::Unit;

// ----------------------------------------------------------------------------

Quantity::Quantity()
    : myValue {0.0}
{}

Quantity::Quantity(double value, const Unit& unit)
    : myValue {value}
    , myUnit {unit}
{}

double Quantity::getValueAs(const Quantity& other) const
{
    return myValue / other.getValue();
}

bool Quantity::operator==(const Quantity& that) const
{
    return (myValue == that.myValue) && (myUnit == that.myUnit);
}

bool Quantity::operator!=(const Quantity& that) const
{
    return !(*this == that);
}

bool Quantity::operator<(const Quantity& that) const
{
    if (myUnit != that.myUnit) {
        throw UnitsMismatchError(
            "Quantity::operator <(): quantities need to have same unit to compare"
        );
    }

    return (myValue < that.myValue);
}

bool Quantity::operator>(const Quantity& that) const
{
    if (myUnit != that.myUnit) {
        throw UnitsMismatchError(
            "Quantity::operator >(): quantities need to have same unit to compare"
        );
    }

    return (myValue > that.myValue);
}

bool Quantity::operator<=(const Quantity& that) const
{
    if (myUnit != that.myUnit) {
        throw UnitsMismatchError(
            "Quantity::operator <=(): quantities need to have same unit to compare"
        );
    }

    return (myValue <= that.myValue);
}

bool Quantity::operator>=(const Quantity& that) const
{
    if (myUnit != that.myUnit) {
        throw UnitsMismatchError(
            "Quantity::operator >=(): quantities need to have same unit to compare"
        );
    }

    return (myValue >= that.myValue);
}

Quantity Quantity::operator*(const Quantity& other) const
{
    return Quantity(myValue * other.myValue, myUnit * other.myUnit);
}

Quantity Quantity::operator*(double factor) const
{
    return Quantity(myValue * factor, myUnit);
}

Quantity Quantity::operator/(const Quantity& other) const
{
    return Quantity(myValue / other.myValue, myUnit / other.myUnit);
}

Quantity Quantity::operator/(double factor) const
{
    return Quantity(myValue / factor, myUnit);
}

Quantity Quantity::pow(const Quantity& other) const
{
    if (!other.isDimensionless()) {
        throw UnitsMismatchError("Quantity::pow(): exponent must not have a unit");
    }

    // Forge: upstream passed static_cast<signed char>(other.myValue) to Unit::pow,
    // which truncated 0.5 to 0 and returned a dimensionless number for the square
    // root of an area. Unit::pow(double) refuses a non-integral unit exponent.
    return Quantity(std::pow(myValue, other.myValue), myUnit.pow(other.myValue));
}

Quantity Quantity::pow(double exp) const
{
    return Quantity(std::pow(myValue, exp), myUnit.pow(exp));
}

Quantity Quantity::operator+(const Quantity& other) const
{
    if (myUnit != other.myUnit) {
        throw UnitsMismatchError("Quantity::operator +(): Unit mismatch in plus operation");
    }

    return Quantity(myValue + other.myValue, myUnit);
}

Quantity& Quantity::operator+=(const Quantity& other)
{
    if (myUnit != other.myUnit) {
        throw UnitsMismatchError("Quantity::operator +=(): Unit mismatch in plus operation");
    }

    myValue += other.myValue;

    return *this;
}

Quantity Quantity::operator-(const Quantity& other) const
{
    if (myUnit != other.myUnit) {
        throw UnitsMismatchError("Quantity::operator -(): Unit mismatch in minus operation");
    }

    return Quantity(myValue - other.myValue, myUnit);
}

Quantity& Quantity::operator-=(const Quantity& other)
{
    if (myUnit != other.myUnit) {
        throw UnitsMismatchError("Quantity::operator -=(): Unit mismatch in minus operation");
    }

    myValue -= other.myValue;

    return *this;
}

Quantity Quantity::operator-() const
{
    return Quantity(-myValue, myUnit);
}

std::string Quantity::toString(int significantDigits) const
{
    const std::string unit = myUnit.getString();
    return unit.empty() ? toNumber(significantDigits)
                        : toNumber(significantDigits) + " " + unit;
}

std::string Quantity::toNumber(int significantDigits) const
{
    std::ostringstream ss;
    ss << std::setprecision(significantDigits) << myValue;
    return ss.str();
}

/// true if unit equals to 1, therefore quantity has no dimension
bool Quantity::isDimensionless() const
{
    return myUnit == Unit::One;
}

/// true if it has a specific unit or no dimension.
bool Quantity::isDimensionlessOrUnit(const Unit& unit) const
{
    return isDimensionless() || myUnit == unit;
}

// true if it has a number with or without a unit
bool Quantity::isValid() const
{
    return !std::isnan(myValue);
}

void Quantity::setInvalid()
{
    myValue = std::numeric_limits<double>::quiet_NaN();
}

// === Predefined types =====================================================
// clang-format off
using namespace forge::expr::UnitsConvData;

const Quantity Quantity::NanoMetre              ( 1.0e-6                , Unit::Length                  );
const Quantity Quantity::MicroMetre             ( 1.0e-3                , Unit::Length                  );
const Quantity Quantity::MilliMetre             ( 1.0                   , Unit::Length                  );
const Quantity Quantity::CentiMetre             ( 10.0                  , Unit::Length                  );
const Quantity Quantity::DeciMetre              ( 100.0                 , Unit::Length                  );
const Quantity Quantity::Metre                  ( 1.0e3                 , Unit::Length                  );
const Quantity Quantity::KiloMetre              ( 1.0e6                 , Unit::Length                  );

const Quantity Quantity::MilliLiter             ( 1000.0                , Unit::Volume                  );
const Quantity Quantity::Liter                  ( 1.0e6                 , Unit::Volume                  );

const Quantity Quantity::Hertz                  ( 1.0                   , Unit::Frequency               );
const Quantity Quantity::KiloHertz              ( 1.0e3                 , Unit::Frequency               );
const Quantity Quantity::MegaHertz              ( 1.0e6                 , Unit::Frequency               );
const Quantity Quantity::GigaHertz              ( 1.0e9                 , Unit::Frequency               );
const Quantity Quantity::TeraHertz              ( 1.0e12                , Unit::Frequency               );

const Quantity Quantity::MicroGram              ( 1.0e-9                , Unit::Mass                    );
const Quantity Quantity::MilliGram              ( 1.0e-6                , Unit::Mass                    );
const Quantity Quantity::Gram                   ( 1.0e-3                , Unit::Mass                    );
const Quantity Quantity::KiloGram               ( 1.0                   , Unit::Mass                    );
const Quantity Quantity::Ton                    ( 1.0e3                 , Unit::Mass                    );

const Quantity Quantity::Second                 ( 1.0                   , Unit::TimeSpan                );
const Quantity Quantity::Minute                 ( 60.0                  , Unit::TimeSpan                );
const Quantity Quantity::Hour                   ( 3600.0                , Unit::TimeSpan                );

const Quantity Quantity::Ampere                 ( 1.0                   , Unit::ElectricCurrent         );
const Quantity Quantity::NanoAmpere             ( 1.0e-9                , Unit::ElectricCurrent         );
const Quantity Quantity::MicroAmpere            ( 1.0e-6                , Unit::ElectricCurrent         );
const Quantity Quantity::MilliAmpere            ( 0.001                 , Unit::ElectricCurrent         );
const Quantity Quantity::KiloAmpere             ( 1000.0                , Unit::ElectricCurrent         );
const Quantity Quantity::MegaAmpere             ( 1.0e6                 , Unit::ElectricCurrent         );

const Quantity Quantity::Kelvin                 ( 1.0                   , Unit::Temperature             );
const Quantity Quantity::MilliKelvin            ( 0.001                 , Unit::Temperature             );
const Quantity Quantity::MicroKelvin            ( 0.000001              , Unit::Temperature             );

const Quantity Quantity::NanoMole               ( 1e-9                  , Unit::AmountOfSubstance       );
const Quantity Quantity::MicroMole              ( 1e-6                  , Unit::AmountOfSubstance       );
const Quantity Quantity::MilliMole              ( 0.001                 , Unit::AmountOfSubstance       );
const Quantity Quantity::Mole                   ( 1.0                   , Unit::AmountOfSubstance       );

const Quantity Quantity::Candela                ( 1.0                   , Unit::LuminousIntensity       );

const Quantity Quantity::Inch                   ( in                    , Unit::Length                  );
const Quantity Quantity::Foot                   ( ft                    , Unit::Length                  );
const Quantity Quantity::Thou                   ( in / 1000             , Unit::Length                  );
const Quantity Quantity::Yard                   ( yd                    , Unit::Length                  );
const Quantity Quantity::Mile                   ( mi                    , Unit::Length                  );

const Quantity Quantity::MilePerHour            ( mi / 3600             , Unit::Velocity                );

const Quantity Quantity::SquareFoot             ( ft * ft               , Unit::Area                    );
const Quantity Quantity::CubicFoot              ( ft * ft * ft          , Unit::Volume                  );

const Quantity Quantity::Pound                  ( lb                    , Unit::Mass                    );
const Quantity Quantity::Ounce                  ( lb / 16               , Unit::Mass                    );
const Quantity Quantity::Stone                  ( lb * 14               , Unit::Mass                    );
const Quantity Quantity::Hundredweights         ( lb * 112              , Unit::Mass                    );

const Quantity Quantity::PoundForce             ( 1000 * lbf            , Unit::Force                   );

const Quantity Quantity::Newton                 ( 1000.0                , Unit::Force                   );  // Newton (kg*m/s^2)
const Quantity Quantity::MilliNewton            ( 1.0                   , Unit::Force                   );
const Quantity Quantity::KiloNewton             ( 1e+6                  , Unit::Force                   );
const Quantity Quantity::MegaNewton             ( 1e+9                  , Unit::Force                   );

const Quantity Quantity::NewtonPerMeter         ( 1.00                  , Unit::Stiffness               );  // Newton per meter (N/m or kg/s^2)
const Quantity Quantity::MilliNewtonPerMeter    ( 1e-3                  , Unit::Stiffness               );
const Quantity Quantity::KiloNewtonPerMeter     ( 1e3                   , Unit::Stiffness               );
const Quantity Quantity::MegaNewtonPerMeter     ( 1e6                   , Unit::Stiffness               );

const Quantity Quantity::Pascal                 ( 0.001                 , Unit::Pressure                );  // Pascal (kg/m/s^2 or N/m^2)
const Quantity Quantity::KiloPascal             ( 1.00                  , Unit::Pressure                );
const Quantity Quantity::MegaPascal             ( 1000.0                , Unit::Pressure                );
const Quantity Quantity::GigaPascal             ( 1e+6                  , Unit::Pressure                );

const Quantity Quantity::MilliBar               ( 0.1                   , Unit::Pressure                );
const Quantity Quantity::Bar                    ( 100.0                 , Unit::Pressure                );  // 1 bar = 100 kPa

const Quantity Quantity::Torr                   ( 101.325 / 760.0       , Unit::Pressure                );  // Torr is a defined fraction of Pascal (kg/m/s^2 or N/m^2)
const Quantity Quantity::mTorr                  ( 101.325 / 760.0 / 1e3 , Unit::Pressure                );  // Torr is a defined fraction of Pascal (kg/m/s^2 or N/m^2)
const Quantity Quantity::yTorr                  ( 101.325 / 760.0 / 1e6 , Unit::Pressure                );  // Torr is a defined fraction of Pascal (kg/m/s^2 or N/m^2)

const Quantity Quantity::PSI                    ( psi                   , Unit::Pressure                );
const Quantity Quantity::KSI                    ( psi * 1000            , Unit::Pressure                );
const Quantity Quantity::MPSI                   ( psi * 1000000         , Unit::Pressure                );

const Quantity Quantity::Watt                   ( 1e+6                  , Unit::Power                   );  // Watt (kg*m^2/s^3)
const Quantity Quantity::NanoWatt               ( 1e-3                  , Unit::Power                   );
const Quantity Quantity::MicroWatt              ( 1.0                   , Unit::Power                   );
const Quantity Quantity::MilliWatt              ( 1e+3                  , Unit::Power                   );
const Quantity Quantity::KiloWatt               ( 1e+9                  , Unit::Power                   );
const Quantity Quantity::VoltAmpere             ( 1e+6                  , Unit::Power                   );  // VoltAmpere (kg*m^2/s^3)

const Quantity Quantity::Volt                   ( 1e+6                  , Unit::ElectricPotential       );  // Volt (kg*m^2/A/s^3)
const Quantity Quantity::MilliVolt              ( 1e+3                  , Unit::ElectricPotential       );
const Quantity Quantity::KiloVolt               ( 1e+9                  , Unit::ElectricPotential       );

const Quantity Quantity::MegaSiemens            ( 1.0                   , Unit::ElectricalConductance   );
const Quantity Quantity::KiloSiemens            ( 1e-3                  , Unit::ElectricalConductance   );
const Quantity Quantity::Siemens                ( 1e-6                  , Unit::ElectricalConductance   );  // Siemens (A^2*s^3/kg/m^2)
const Quantity Quantity::MilliSiemens           ( 1e-9                  , Unit::ElectricalConductance   );
const Quantity Quantity::MicroSiemens           ( 1e-12                 , Unit::ElectricalConductance   );

const Quantity Quantity::Ohm                    ( 1e+6                  , Unit::ElectricalResistance    );  // Ohm (kg*m^2/A^2/s^3)
const Quantity Quantity::KiloOhm                ( 1e+9                  , Unit::ElectricalResistance    );
const Quantity Quantity::MegaOhm                ( 1e+12                 , Unit::ElectricalResistance    );

const Quantity Quantity::Coulomb                ( 1.0                   , Unit::ElectricCharge          );  // Coulomb (A*s)

const Quantity Quantity::Tesla                  ( 1.0                   , Unit::MagneticFluxDensity     );  // Tesla (kg/s^2/A)
const Quantity Quantity::MilliTesla             ( 1e-3                  , Unit::MagneticFluxDensity     );
const Quantity Quantity::Gauss                  ( 1e-4                  , Unit::MagneticFluxDensity     );  // 1 G = 1e-4 T

const Quantity Quantity::Weber                  ( 1e6                   , Unit::MagneticFlux            );  // Weber (kg*m^2/s^2/A)

const Quantity Quantity::PicoFarad              ( 1e-18                 , Unit::ElectricalCapacitance   );
const Quantity Quantity::NanoFarad              ( 1e-15                 , Unit::ElectricalCapacitance   );
const Quantity Quantity::MicroFarad             ( 1e-12                 , Unit::ElectricalCapacitance   );
const Quantity Quantity::MilliFarad             ( 1e-9                  , Unit::ElectricalCapacitance   );
const Quantity Quantity::Farad                  ( 1e-6                  , Unit::ElectricalCapacitance   );  // Farad (s^4*A^2/m^2/kg)

const Quantity Quantity::NanoHenry              ( 1e-3                  , Unit::ElectricalInductance    );
const Quantity Quantity::MicroHenry             ( 1.0                   , Unit::ElectricalInductance    );
const Quantity Quantity::MilliHenry             ( 1e+3                  , Unit::ElectricalInductance    );
const Quantity Quantity::Henry                  ( 1e+6                  , Unit::ElectricalInductance    );  // Henry (kg*m^2/s^2/A^2)

const Quantity Quantity::Joule                  ( 1e+6                  , Unit::Work                    );  // Joule (kg*m^2/s^2)
const Quantity Quantity::MilliJoule             ( 1e+3                  , Unit::Work                    );
const Quantity Quantity::KiloJoule              ( 1e+9                  , Unit::Work                    );
const Quantity Quantity::VoltAmpereSecond       ( 1e+6                  , Unit::Work                    );  // Joule (kg*m^2/s^2)
const Quantity Quantity::WattSecond             ( 1e+6                  , Unit::Work                    );  // Joule (kg*m^2/s^2)
const Quantity Quantity::KiloWattHour           ( 3.6e+12               , Unit::Work                    );  // 1 kWh = 3.6e6 J
const Quantity Quantity::ElectronVolt           ( 1.602176634e-13       , Unit::Work                    );  // 1 eV = 1.602176634e-19 J
const Quantity Quantity::KiloElectronVolt       ( 1.602176634e-10       , Unit::Work                    );
const Quantity Quantity::MegaElectronVolt       ( 1.602176634e-7        , Unit::Work                    );
const Quantity Quantity::Calorie                ( 4.1868e+6             , Unit::Work                    );  // 1 cal = 4.1868 J
const Quantity Quantity::KiloCalorie            ( 4.1868e+9             , Unit::Work                    );
const Quantity Quantity::NewtonMeter            ( 1e+6                  , Unit::Moment                  );  // Joule (kg*m^2/s^2)

const Quantity Quantity::KMH                    ( 1e+6 / 3600           , Unit::Velocity                );  // km/h
const Quantity Quantity::MPH                    ( mi / 3600             , Unit::Velocity                );  // Mile/h

const Quantity Quantity::AngMinute              ( 1.0 / 60.0            , Unit::Angle                   );  // angular minute
const Quantity Quantity::AngSecond              ( 1.0 / 3600.0          , Unit::Angle                   );  // angular second
const Quantity Quantity::Degree                 ( 1.0                   , Unit::Angle                   );  // degree (internal standard angle)
const Quantity Quantity::Radian                 ( 180 / std::numbers::pi, Unit::Angle                   );  // radian
const Quantity Quantity::Gon                    ( 360.0 / 400.0         , Unit::Angle                   );  // gon
// clang-format on
