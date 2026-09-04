#!/usr/bin/env python3
# setback_pair_predicate_probe.py — WHY blendBatch's co-moving guard is TOPOLOGICAL
# and not the obvious analytic predicate.
#
# The obvious guard for two blended edges that bound the same face is
#     min_dist(edge_i, edge_j) > q_i + q_j
# and it is WRONG IN BOTH DIRECTIONS. This probe is the measurement that says so.
# It models blendBatch's ACTUAL rebuild: a SELECTED edge's supporting line is offset
# inward by q, every OTHER edge stays put, and each vertex becomes the intersection
# of its two incident lines (offsetLine + lineIsect, NativeFilletChamfer.cpp step 3).
#
# MEASURED (seed 11, 4,584 configurations over random strictly-convex rings):
#   FALSE NEGATIVE  d=11.264906 vs 2q=9.011925 — predicate calls it SAFE, ring FOLDS.
#     The retrimmed lines are re-intersected with their NEIGHBOURS, so they extend past
#     the original segment ends; a FINITE-SEGMENT distance therefore OVERESTIMATES the
#     clearance whenever the two edges are not parallel, and the fold happens outside
#     the span it measured. This one ships a wrong body, which is why the analytic
#     predicate was removed rather than tuned.
#   FALSE POSITIVE  d=3.979817 vs 2q=4.059414 — predicate DEFERS a ring that is fine,
#     because two edges separated by a SHORT third edge are close without ever meeting
#     once offset.
#
# Run:  python3 forge-kernel/test/setback_pair_predicate_probe.py
import math, random

def sub(a,b): return (a[0]-b[0], a[1]-b[1])
def add(a,b): return (a[0]+b[0], a[1]+b[1])
def mul(a,s): return (a[0]*s, a[1]*s)
def cross(a,b): return a[0]*b[1]-a[1]*b[0]
def norm(v):
    z=math.hypot(*v);  return (v[0]/z, v[1]/z)

def line_inter(a,u,b,v):
    den=cross(u,v)
    if abs(den)<1e-12: return None
    t=cross(sub(b,a),v)/den
    return add(a,mul(u,t))

def seg_dist(a,b,c,d):
    def o(p,q,r): return cross(sub(q,p),sub(r,p))
    if o(a,b,c)*o(a,b,d)<0 and o(c,d,a)*o(c,d,b)<0: return 0.0
    def pd(p,a,b):
        u=sub(b,a); den=u[0]**2+u[1]**2
        t=max(0.0,min(1.0,((p[0]-a[0])*u[0]+(p[1]-a[1])*u[1])/den))
        return math.hypot(p[0]-(a[0]+t*u[0]), p[1]-(a[1]+t*u[1]))
    return min(pd(a,c,d),pd(b,c,d),pd(c,a,b),pd(d,a,b))

def area(P):
    s=0.0
    for i in range(len(P)): s+=cross(P[i],P[(i+1)%len(P)])
    return s/2.0

def simple(P):
    n=len(P)
    def o(p,q,r): return cross(sub(q,p),sub(r,p))
    for i in range(n):
        a,b=P[i],P[(i+1)%n]
        for j in range(i+1,n):
            if j==i or (j+1)%n==i or (i+1)%n==j: continue
            c,d=P[j],P[(j+1)%n]
            if o(a,b,c)*o(a,b,d)<-1e-12 and o(c,d,a)*o(c,d,b)<-1e-12: return False
    return True

def rebuild(P, sel, q):
    n=len(P)
    lines=[]
    for i in range(n):
        a,b=P[i],P[(i+1)%n]
        u=norm(sub(b,a)); nrm=(-u[1],u[0])          # inward (left) for CCW
        base = add(a, mul(nrm,q)) if i in sel else a
        lines.append((base,u))
    Q=[]
    for i in range(n):                               # vertex i = line(i-1) ^ line(i)
        x=line_inter(lines[i-1][0],lines[i-1][1],lines[i][0],lines[i][1])
        if x is None: return None
        Q.append(x)
    return Q

random.seed(11)
fn=[]; fp=[]; tested=0
for _ in range(400000):
    n=random.choice([4,5,6,7])
    ang=sorted(random.random()*2*math.pi for _ in range(n))
    P=[(math.cos(a)*random.uniform(6,20), math.sin(a)*random.uniform(6,20)) for a in ang]
    if area(P)<=0: P=P[::-1]
    if not all(cross(sub(P[(i+1)%n],P[i]), sub(P[(i+2)%n],P[(i+1)%n]))>1e-4 for i in range(n)):
        continue                                     # keep strictly convex
    # two edges sharing no vertex
    cand=[(i,j) for i in range(n) for j in range(i+1,n)
          if j!=i and (j+1)%n!=i and (i+1)%n!=j]
    if not cand: continue
    i,j=random.choice(cand)
    a0,a1=P[i],P[(i+1)%n]; b0,b1=P[j],P[(j+1)%n]
    d=seg_dist(a0,a1,b0,b1)
    if d<1e-6: continue
    for f in (0.20,0.40,0.49,0.51,0.60,0.80,0.95,1.05):
        q=d*f
        Q=rebuild(P,{i,j},q)
        if Q is None: continue
        tested+=1
        folded = (not simple(Q)) or area(Q)<=0
        predicted_fold = (d <= 2*q)
        if predicted_fold and not folded and len(fp)<3: fp.append((P,i,j,q,d,Q))
        if (not predicted_fold) and folded and len(fn)<3: fn.append((P,i,j,q,d,Q))
    if len(fn)>=3 and len(fp)>=3: break

print("configurations tested:", tested)
print("FALSE NEGATIVES (predicate says SAFE, ring actually FOLDS):", len(fn))
for P,i,j,q,d,Q in fn[:2]:
    print("   d=%.6f 2q=%.6f edges=(%d,%d) n=%d" % (d,2*q,i,j,len(P)))
print("FALSE POSITIVES (predicate DEFERS, ring is actually fine):", len(fp))
for P,i,j,q,d,Q in fp[:2]:
    print("   d=%.6f 2q=%.6f edges=(%d,%d) n=%d" % (d,2*q,i,j,len(P)))
