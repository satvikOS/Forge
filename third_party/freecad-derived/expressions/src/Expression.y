/* SPDX-License-Identifier: LGPL-2.1-or-later */

/***************************************************************************
 *   Copyright (c) 2010 Jürgen Riegel <FreeCAD@juergen-riegel.net>         *
 *   Copyright (c) 2015 Eivind Kvedalen <eivind@kvedalen.name>             *
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

/* Parser for the FreeCAD Expression language */

/* MODIFIED for libforge_expr (2026-09-15) from FreeCAD src/App/Expression.y at
 * commit 0a45a0a008d4af7a85601016c5ab31bd26c25b22. See MODIFICATIONS.md.
 *
 * The GRAMMAR -- every rule, every token and every precedence declaration -- is
 * upstream's, so the language a user types is FreeCAD's. What changed:
 *   * the semantic actions no longer take an App::DocumentObject owner, and a
 *     property path is a plain dotted string instead of an App::ObjectIdentifier;
 *     resolving a name is the caller's job (forge_expr/Evaluator.h, SymbolTable)
 *   * a function call whose name or argument count is wrong is reported with
 *     YYERROR from the action instead of an exception thrown through the parser,
 *     so the parser's own %destructor cleanup runs and nothing leaks
 *   * one token is added, LEXERROR, which the lexer returns for a character or a
 *     number it cannot read; it appears in no rule, so it is always a syntax error
 *   * the unused `functions` stack is removed
 *
 * Regenerate Expression.tab.c / Expression.tab.h with ExpressionParser.sh
 * (GNU Bison 3.8.2, -l so no #line directives). */

%{
#define YYSTYPE forge::expr::ExpressionParser::semantic_type

#define yyparse ExpressionParser_yyparse
#define yyerror ExpressionParser_yyerror
%}

     %token FUNC
     %token ONE
     %token NUM
     %token IDENTIFIER
     %token UNIT USUNIT
     %token INTEGER
     %token CONSTANT
     %token CELLADDRESS
     %token EQ NEQ LT GT GTE LTE
     %token STRING MINUSSIGN PROPERTY_REF
     %token DOCUMENT OBJECT
     %token EXPONENT
     %token LEXERROR
     %type <arguments> args
     %type <expr> input unit_num us_building_unit other_unit exp unit_exp indexable
     %type <quantity> UNIT USUNIT
     %type <string> id_or_cell STRING IDENTIFIER CELLADDRESS
     %type <ivalue> INTEGER
     %type <string> PROPERTY_REF
     %type <fvalue> ONE
     %type <fvalue> NUM
     %type <constant> CONSTANT
     %type <expr> num
     %type <expr> range
     %type <path> identifier iden
     %type <component> indexer
     %type <func> FUNC
     %type <string_or_identifier> document
     %type <string_or_identifier> object
     %type <ivalue> integer
     %right '?' ':'
     %left EQ NEQ LT GT GTE LTE
     %left MINUSSIGN '+'
     %left '*' '/' '%'
     %precedence NUM_AND_UNIT
     %left '^'
     %precedence NEG
     %precedence POS

%destructor { delete $$; } num range exp unit_exp indexable
%destructor { delete $$; } <component>
%destructor { std::vector<Expression*>::const_iterator i = $$.begin(); while (i != $$.end()) { delete *i; ++i; } } args

%start input
%%


input:     exp                                  { ScanResult = std::unique_ptr<Expression>($1); valueExpression = true;                                        }
     |     unit_exp                             { ScanResult = std::unique_ptr<Expression>($1); unitExpression = true;                                         }
     ;

unit_num: num unit_exp %prec NUM_AND_UNIT       { $$ = new OperatorExpression($1, OperatorExpression::UNIT, $2);  }
        | num us_building_unit num us_building_unit %prec NUM_AND_UNIT   { $$ = new OperatorExpression(new OperatorExpression($1, OperatorExpression::UNIT, $2), OperatorExpression::ADD, new OperatorExpression($3, OperatorExpression::UNIT, $4));}
        ;

exp:      num                                   { $$ = $1;                                                                        }
        | unit_num                              { $$ = $1;                                                                        }
        | STRING                                { $$ = new StringExpression($1);                                                  }
        | identifier                            { $$ = new VariableExpression($1);                                                }
        | MINUSSIGN exp %prec NEG               { $$ = new OperatorExpression($2, OperatorExpression::NEG, new NumberExpression(Quantity(-1))); }
        | '+' exp %prec POS                     { $$ = new OperatorExpression($2, OperatorExpression::POS, new NumberExpression(Quantity(1))); }
        | exp '+' exp                           { $$ = new OperatorExpression($1, OperatorExpression::ADD, $3);   }
        | exp MINUSSIGN exp                     { $$ = new OperatorExpression($1, OperatorExpression::SUB, $3);   }
        | exp '*' exp                           { $$ = new OperatorExpression($1, OperatorExpression::MUL, $3);   }
        | exp '/' exp                           { $$ = new OperatorExpression($1, OperatorExpression::DIV, $3);   }
        | exp '%' exp                           { $$ = new OperatorExpression($1, OperatorExpression::MOD, $3);   }
        | exp '/' unit_exp                      { $$ = new OperatorExpression($1, OperatorExpression::DIV, $3);   }
        | exp '^' exp                           { $$ = new OperatorExpression($1, OperatorExpression::POW, $3);   }
        | exp EQ exp                            { $$ = new OperatorExpression($1, OperatorExpression::EQ, $3);    }
        | exp NEQ exp                           { $$ = new OperatorExpression($1, OperatorExpression::NEQ, $3);   }
        | exp LT exp                            { $$ = new OperatorExpression($1, OperatorExpression::LT, $3);    }
        | exp GT exp                            { $$ = new OperatorExpression($1, OperatorExpression::GT, $3);    }
        | exp GTE exp                           { $$ = new OperatorExpression($1, OperatorExpression::GTE, $3);   }
        | exp LTE exp                           { $$ = new OperatorExpression($1, OperatorExpression::LTE, $3);   }
        | indexable                             { $$ = $1;                                                                        }
        | FUNC  args ')'                        { FunctionExpression* call = new FunctionExpression($1.first, std::move($1.second), $2);
                                                  if (!call->constructionError().empty()) {
                                                      parseFailure = call->constructionError();
                                                      delete call;
                                                      YYERROR;
                                                  }
                                                  $$ = call;                                                                      }
        | exp '?' exp ':' exp                   { $$ = new ConditionalExpression($1, $3, $5);                                     }
        | '(' exp ')'                           { $$ = $2; }
        ;

num:       ONE                                  { $$ = new NumberExpression(Quantity($1));                                        }
         | NUM                                  { $$ = new NumberExpression(Quantity($1));                                        }
         | INTEGER                              { $$ = new NumberExpression(Quantity((double)$1));                                }
         | CONSTANT                             { $$ = new ConstantExpression($1.name, Quantity($1.fvalue));                      }

args: exp                                       { $$.push_back($1);                                                               }
    | range                                     { $$.push_back($1);                                                               }
    | args ',' exp                              { $1.push_back($3);  $$ = $1;                                                     }
    | args ';' exp                              { $1.push_back($3);  $$ = $1;                                                     }
    | args ',' range                            { $1.push_back($3);  $$ = $1;                                                     }
    | args ';' range                            { $1.push_back($3);  $$ = $1;                                                     }
    ;

range: id_or_cell ':' id_or_cell                { $$ = new RangeExpression($1, $3);                                               }
     ;


us_building_unit: USUNIT                        { $$ = new UnitExpression($1.scaler, $1.unitStr );                                }
other_unit: UNIT                                { $$ = new UnitExpression($1.scaler, $1.unitStr );                                }

unit_exp: other_unit                            { $$ = $1; }
        | us_building_unit                      { $$ = $1; }
        | unit_exp '/' unit_exp                 { $$ = new OperatorExpression($1, OperatorExpression::DIV, $3);   }
        | unit_exp '*' unit_exp                 { $$ = new OperatorExpression($1, OperatorExpression::MUL, $3);   }
        | unit_exp '^' integer                  { $$ = new OperatorExpression($1, OperatorExpression::POW, new NumberExpression(Quantity((double)$3)));   }
        | unit_exp '^' MINUSSIGN integer        { $$ = new OperatorExpression($1, OperatorExpression::POW, new OperatorExpression(new NumberExpression(Quantity((double)$4)), OperatorExpression::NEG, new NumberExpression(Quantity(-1))));   }
        | '(' unit_exp ')'                      { $$ = $2;                                                                        }
        ;

integer: INTEGER { $$ = $1; }
       | ONE { $$ = $1; }
       ;

id_or_cell
    : IDENTIFIER                            { $$ = std::move($1); }
    | CELLADDRESS                           { $$ = std::move($1); }
    ;

identifier
    : id_or_cell                            { $$ = std::move($1); }
    | iden                                  { $$ = std::move($1); }
    ;

iden
    :  '.' STRING '.' id_or_cell            { /* Path to property of a sub-object of the current object*/
                                                $$ = "." + quotePathString($2) + "." + $4;
                                            }
    | '.' id_or_cell                        { /* Path to property of the current document object */
                                                $$ = "." + $2;
                                            }
    | object '.' STRING '.' id_or_cell      { /* Path to property of a sub-object */
                                                $$ = $1 + "." + quotePathString($3) + "." + $5;
                                            }
    | object '.' id_or_cell                 { /* Path to property of a given document object */
                                                $$ = $1 + "." + $3;
                                            }
    | document '#' object '.' id_or_cell    { /* Path to property from an external document, within a named document object */
                                                $$ = $1 + "#" + $3 + "." + $5;
                                            }
    | document '#' object '.' STRING '.' id_or_cell
                                            {   $$ = $1 + "#" + $3 + "." + quotePathString($5) + "." + $7;
                                            }
    | iden '.' IDENTIFIER                   { $$ = $1 + "." + $3; }
    ;

indexer
    : '[' exp ']'                           { $$ = Expression::createComponent($2);   }
    | '[' exp ':' ']'                       { $$ = Expression::createComponent($2,0,0,true); }
    | '[' ':' exp ']'                       { $$ = Expression::createComponent(0,$3); }
    | '[' ':' ':' exp ']'                   { $$ = Expression::createComponent(0,0,$4); }
    | '[' exp ':' exp ']'                   { $$ = Expression::createComponent($2,$4);}
    | '[' exp ':' ':' exp ']'               { $$ = Expression::createComponent($2,0,$5); }
    | '[' ':' exp ':' exp ']'               { $$ = Expression::createComponent(0,$3,$5); }
    | '[' exp ':' exp ':' exp ']'           { $$ = Expression::createComponent($2,$4,$6);}
    ;

indexable
    : identifier indexer                    { $$ = new VariableExpression($1); $$->addComponent($2); }
    | indexable indexer                     { $1->addComponent(std::move($2)); $$ = $1; }
    | indexable '.' IDENTIFIER              { $1->addComponent(Expression::createComponent($3)); $$ = $1; }
    ;

document
    : STRING                                { $$ = quotePathString($1); }
    | IDENTIFIER                            { $$ = std::move($1); }
    ;

object
    : STRING                                { $$ = quotePathString($1); }
    | id_or_cell                            { $$ = std::move($1); }
    ;

%%
