# Simple, beautiful cursive: one shared curve shape, one consistent slant.
# Authored upright, then slanted and centred — so every letter matches.
import math, json
A,M,B,D = .18,.30,.58,.75          # ascender, x-height top, baseline, descender
CT, CB   = .19, .58                # capitals: top, baseline
SLANT    = .20                     # ~11 degrees — the single biggest beauty win
W        = .085                    # one arch/trough wide

def cub(p0,p1,p2,p3,n=16):
    return [((1-t)**3*p0[0]+3*(1-t)**2*t*p1[0]+3*(1-t)*t*t*p2[0]+t**3*p3[0],
             (1-t)**3*p0[1]+3*(1-t)**2*t*p1[1]+3*(1-t)*t*t*p2[1]+t**3*p3[1])
            for t in [i/n for i in range(n+1)]]
def line(p0,p1,n=6):
    return [(p0[0]+(p1[0]-p0[0])*i/n, p0[1]+(p1[1]-p0[1])*i/n) for i in range(n+1)]
def J(*parts):
    out=[]
    for p in parts:
        for pt in p:
            if not out or abs(pt[0]-out[-1][0])>1e-4 or abs(pt[1]-out[-1][1])>1e-4: out.append(pt)
    return out

# --- the shared vocabulary: every curve in the alphabet is one of these ---
def trough(x0,x1):                 # down, round the bottom, up   (i u w y)
    return cub((x0,M),(x0,B+.10),(x1,B+.10),(x1,M))
def arch(x0,x1):                   # up, over the top, down       (n m h r)
    return cub((x0,B),(x0,M-.10),(x1,M-.10),(x1,B))
def oval(x0,x1):                   # the round body               (a c d g o q)
    cx,rx,cy,ry=(x0+x1)/2,(x1-x0)/2,(M+B)/2,(B-M)/2
    k=.5523
    return J(cub((cx+rx,cy),(cx+rx,cy-ry*k),(cx+rx*k,cy-ry),(cx,cy-ry)),
             cub((cx,cy-ry),(cx-rx*k,cy-ry),(cx-rx,cy-ry*k),(cx-rx,cy)),
             cub((cx-rx,cy),(cx-rx,cy+ry*k),(cx-rx*k,cy+ry),(cx,cy+ry)),
             cub((cx,cy+ry),(cx+rx*k,cy+ry),(cx+rx,cy+ry*k),(cx+rx,cy)))
def stem(x,y0,y1):     return line((x,y0),(x,y1),8)
def enter(x):          return cub((x-.05,B),(x-.03,B),(x-.012,M+.10),(x,M))   # rise in
def leave(x,y=B):      return cub((x,y),(x+.018,y),(x+.036,y-.03),(x+.055,y-.07))
def asc_loop(x):       return J(cub((x,B),(x-.03,M-.06),(x-.022,A+.02),(x,A)),
                                cub((x,A),(x+.026,A+.05),(x+.012,M-.02),(x,B)))
def desc_loop(x):      return J(cub((x,B),(x+.012,D-.06),(x+.004,D),(x-.022,D)),
                                cub((x-.022,D),(x-.05,D-.02),(x-.045,B-.06),(x-.012,B-.10)))

def oval_top(x0,x1):               # same body, but pen starts and ends at the top
    cx,rx,cy,ry=(x0+x1)/2,(x1-x0)/2,(M+B)/2,(B-M)/2
    k=.5523
    return J(cub((cx,cy-ry),(cx-rx*k,cy-ry),(cx-rx,cy-ry*k),(cx-rx,cy)),
             cub((cx-rx,cy),(cx-rx,cy+ry*k),(cx-rx*k,cy+ry),(cx,cy+ry)),
             cub((cx,cy+ry),(cx+rx*k,cy+ry),(cx+rx,cy+ry*k),(cx+rx,cy)),
             cub((cx+rx,cy),(cx+rx,cy-ry*k),(cx+rx*k,cy-ry),(cx,cy-ry)))
def dot(x,y):  return [(x,y),(x+.004,y+.004)]      # round cap = a proper dot
L={}
# ---------------- lowercase ----------------
L['a']=[J(oval(.42,.42+W),stem(.42+W,M+.005,B),leave(.42+W))]
L['b']=[J(asc_loop(.44),cub((.44,B-.01),(.476,B-.07),(.522,M+.11),(.514,M+.018)),cub((.514,M+.018),(.506,B-.02),(.458,B+.018),(.4425,B-.012)),leave(.508,B-.055))]
L['c']=[J(cub((.52,M+.04),(.50,M-.01),(.44,M-.005),(.425,M+.10)),
          cub((.425,M+.10),(.41,B+.02),(.47,B+.03),(.515,B-.05)),leave(.515,B-.05))]
L['d']=[J(oval(.40,.40+W),stem(.40+W,M-.12,B),leave(.40+W)),]
L['d']=[J(oval(.40,.40+W),line((.40+W,M+.005),(.40+W,A+.02),6),
          line((.40+W,A+.02),(.40+W,B),8),leave(.40+W))]
L['e']=[J(cub((.415,B-.09),(.46,B-.13),(.50,B-.13),(.495,M+.06)),
          cub((.495,M+.06),(.47,M-.01),(.41,M+.03),(.415,B-.06)),
          cub((.415,B-.06),(.42,B+.03),(.48,B+.02),(.515,B-.05)),leave(.515,B-.05))]
L['f']=[J(asc_loop(.45),line((.45,B),(.45,B),2),desc_loop(.45))]
L['g']=[J(oval(.42,.42+W),stem(.42+W,M+.005,B),desc_loop(.42+W))]
L['h']=[J(asc_loop(.42),arch(.42,.42+W),leave(.42+W))]
L['i']=[J(enter(.44),trough(.44,.44+W*.8),leave(.44+W*.8)), dot(.472,M-.07)]
L['j']=[J(enter(.45),line((.45,M),(.45,B),6),desc_loop(.45)), dot(.462,M-.07)]
L['k']=[J(asc_loop(.42),line((.42,B-.28),(.42,B),4),
          cub((.42,B-.10),(.47,M+.04),(.50,M+.02),(.455,B-.10)),
          cub((.455,B-.10),(.48,B-.06),(.49,B-.02),(.51,B)),leave(.51))]
L['l']=[J(asc_loop(.45),leave(.45))]
L['m']=[J(enter(.36),arch(.36,.36+W),arch(.36+W,.36+2*W),leave(.36+2*W))]
L['n']=[J(enter(.40),arch(.40,.40+W),leave(.40+W))]
L['o']=[J(oval_top(.42,.42+W),cub(((.42+.42+W)/2,M),((.42+.42+W)/2+.03,M-.008),(.50,M+.005),(.525,M+.03)))]
L['p']=[J(enter(.42),line((.42,M),(.42,D-.01),8),line((.42,D-.01),(.425,M+.02),8),
          cub((.425,M+.02),(.50,M-.01),(.505,B),(.425,B-.005)),leave(.50,B-.02))]
L['q']=[J(oval(.42,.42+W),line((.42+W,M+.005),(.42+W,D-.02),8),
          cub((.42+W,D-.02),(.53,D+.01),(.55,D-.04),(.565,D-.08)))]
L['r']=[J(enter(.425),line((.425,M),(.447,M-.034),4),line((.447,M-.034),(.4665,M-.028),3),line((.4665,M-.028),(.4735,M+.006),3),line((.4735,M+.006),(.476,M+.04),3),line((.476,M+.04),(.4775,B),7),leave(.4775))]
L['s']=[J(line((.432,B-.006),(.4645,M+.098),4),line((.4645,M+.098),(.4855,M+.004),4),line((.4855,M+.004),(.4665,M+.034),3),cub((.4665,M+.034),(.4165,M+.09),(.4085,M+.19),(.4345,B-.028)),cub((.4345,B-.028),(.4585,B+.028),(.5065,B+.014),(.532,B-.052)),leave(.532,B-.052))]
L['t']=[J(line((.455,A+.06),(.455,B-.04),8),
          cub((.455,B-.04),(.46,B+.02),(.50,B+.02),(.525,B-.05)),leave(.525,B-.05)),
        line((.41,M-.01),(.515,M-.025),4)]
L['u']=[J(enter(.40),trough(.40,.40+W),line((.40+W,M),(.40+W,B),6),leave(.40+W))]
L['v']=[J(cub((.412,M),(.425,B-.06),(.452,B-.006),(.466,B-.006)),cub((.466,B-.006),(.486,B-.012),(.505,M+.085),(.508,M+.015)),cub((.508,M+.015),(.497,M+.05),(.522,M+.045),(.542,M+.03)))]
L['w']=[J(enter(.365),trough(.365,.365+W*.85),trough(.365+W*.85,.365+W*1.7),
          cub((.365+W*1.7,M),(.35+W*1.7,M+.05),(.38+W*1.7,M+.04),(.40+W*1.7,M+.025)))]
L['x']=[J(enter(.415),cub((.415,M),(.45,M+.10),(.48,B-.06),(.505,B)),leave(.505)),
        line((.515,M+.01),(.405,B-.02),6)]
L['y']=[J(enter(.40),trough(.40,.40+W),line((.40+W,M),(.40+W,B),6),desc_loop(.40+W))]
L['z']=[J(cub((.415,M+.02),(.45,M-.02),(.49,M-.01),(.505,M+.04)),
          cub((.505,M+.04),(.47,B-.09),(.435,B-.03),(.425,B-.005)),
          cub((.425,B-.005),(.46,B-.02),(.495,B-.02),(.51,B-.015)),desc_loop(.51))]
# ---------------- capitals: simple slanted forms, one small entry curve ----------------
def cstem(x,y0=CT,y1=CB): return line((x,y0),(x,y1),10)
def cbowl(x,y0,y1,w=.075):
    cy=(y0+y1)/2; ry=(y1-y0)/2; k=.5523
    return J(cub((x,y0),(x+w*k,y0),(x+w,cy-ry*k),(x+w,cy)),
             cub((x+w,cy),(x+w,cy+ry*k),(x+w*k,y1),(x,y1)))
L['A']=[J(line((.40,CB),(.475,CT),8),line((.475,CT),(.55,CB),8)), line((.425,CB-.13),(.525,CB-.13),4)]
L['B']=[J(cstem(.42),), J(cbowl(.42,CT,(CT+CB)/2),cbowl(.42,(CT+CB)/2,CB,.082))]
L['C']=[J(cub((.545,CT+.05),(.50,CT-.02),(.425,CT+.04),(.42,(CT+CB)/2)),
          cub((.42,(CT+CB)/2),(.415,CB-.03),(.49,CB+.03),(.545,CB-.06)))]
L['D']=[J(cstem(.42),), J(cub((.42,CT),(.53,CT+.01),(.555,(CT+CB)/2-.05),(.555,(CT+CB)/2)),
                          cub((.555,(CT+CB)/2),(.555,CB-.03),(.52,CB),(.42,CB)))]
L['E']=[J(cub((.545,CT+.03),(.47,CT-.02),(.425,CT+.05),(.425,(CT+CB)/2)),
          cub((.425,(CT+CB)/2),(.425,CB-.02),(.48,CB+.02),(.545,CB-.05))),
        line((.425,(CT+CB)/2),(.51,(CT+CB)/2-.01),4)]
L['F']=[J(cstem(.43),), line((.43,CT),(.55,CT-.012),5), line((.43,(CT+CB)/2),(.525,(CT+CB)/2-.01),4)]
L['G']=[J(cub((.545,CT+.05),(.50,CT-.02),(.425,CT+.04),(.42,(CT+CB)/2)),
          cub((.42,(CT+CB)/2),(.415,CB-.03),(.50,CB+.03),(.55,CB-.07)),
          line((.55,CB-.07),(.55,(CT+CB)/2+.02),4),line((.55,(CT+CB)/2+.02),(.495,(CT+CB)/2+.02),3))]
L['H']=[J(cstem(.40),), J(cstem(.545),), line((.40,(CT+CB)/2),(.545,(CT+CB)/2),5)]
L['I']=[J(cstem(.475),), line((.425,CT),(.53,CT),4), line((.425,CB),(.53,CB),4)]
L['J']=[J(line((.51,CT),(.51,CB-.06),8),
          cub((.51,CB-.06),(.51,CB+.03),(.44,CB+.03),(.425,CB-.05)))]
L['K']=[J(cstem(.41),), J(line((.545,CT),(.425,(CT+CB)/2+.01),6),line((.455,(CT+CB)/2-.02),(.555,CB),6))]
L['L']=[J(cstem(.43),line((.43,CB),(.55,CB-.01),5))]
L['M']=[J(line((.375,CB),(.375,CT),8),line((.375,CT),(.465,CB-.05),7),
          line((.465,CB-.05),(.555,CT),7),line((.555,CT),(.555,CB),8))]
L['N']=[J(line((.39,CB),(.39,CT),8),line((.39,CT),(.545,CB),9),line((.545,CB),(.545,CT),8))]
L['O']=[J(cub((.485,CT),(.42,CT+.01),(.405,(CT+CB)/2-.04),(.405,(CT+CB)/2)),
          cub((.405,(CT+CB)/2),(.405,CB-.01),(.43,CB),(.485,CB)),
          cub((.485,CB),(.545,CB),(.565,CB-.06),(.565,(CT+CB)/2)),
          cub((.565,(CT+CB)/2),(.565,CT+.05),(.545,CT),(.485,CT)))]
L['P']=[J(cstem(.43),), J(cbowl(.43,CT,(CT+CB)/2+.02,.088))]
L['Q']=[J(cub((.485,CT),(.42,CT+.01),(.405,(CT+CB)/2-.04),(.405,(CT+CB)/2)),
          cub((.405,(CT+CB)/2),(.405,CB-.01),(.43,CB),(.485,CB)),
          cub((.485,CB),(.545,CB),(.565,CB-.06),(.565,(CT+CB)/2)),
          cub((.565,(CT+CB)/2),(.565,CT+.05),(.545,CT),(.485,CT))),
        line((.50,CB-.08),(.575,CB+.05),4)]
L['R']=[J(cstem(.43),), J(cbowl(.43,CT,(CT+CB)/2,.082),line((.47,(CT+CB)/2),(.555,CB),6))]
L['S']=[J(cub((.545,CT+.04),(.50,CT-.02),(.43,CT+.02),(.435,CT+.10)),
          cub((.435,CT+.10),(.44,(CT+CB)/2+.02),(.535,(CT+CB)/2),(.535,CB-.10)),
          cub((.535,CB-.10),(.535,CB+.02),(.46,CB+.03),(.415,CB-.05)))]
L['T']=[J(cstem(.48),), line((.41,CT),(.55,CT-.012),5)]
L['U']=[J(line((.40,CT),(.40,CB-.07),7),
          cub((.40,CB-.07),(.40,CB+.03),(.545,CB+.03),(.545,CB-.07)),
          line((.545,CB-.07),(.545,CT),7))]
L['V']=[J(line((.40,CT),(.475,CB),8),line((.475,CB),(.55,CT),8))]
L['W']=[J(line((.365,CT),(.42,CB),7),line((.42,CB),(.475,CT+.06),6),
          line((.475,CT+.06),(.53,CB),6),line((.53,CB),(.585,CT),7))]
L['X']=[J(line((.40,CT),(.55,CB),9)), line((.55,CT),(.40,CB),9)]
L['Y']=[J(line((.40,CT),(.475,(CT+CB)/2+.02),6),line((.475,(CT+CB)/2+.02),(.475,CB),5)),
        line((.55,CT),(.475,(CT+CB)/2+.02),6)]
L['Z']=[J(line((.41,CT),(.545,CT-.012),5),line((.545,CT-.012),(.415,CB),9),
          line((.415,CB),(.55,CB-.012),5))]

def slant(pts): return [(x+(B-y)*SLANT, y) for x,y in pts]
def build():
    out={}
    for ch,strokes in L.items():
        st=[slant(s) for s in strokes]
        xs=[p[0] for s in st for p in s]
        dx=0.5-(min(xs)+max(xs))/2                 # centre every letter identically
        out[ch]=[[[round(x+dx,3),round(y,3)] for x,y in s] for s in st]
    return out
if __name__=='__main__':
    o=build(); json.dump(o,open('cursive_strokes.json','w'))
    print(len(o),'letters')
