// ═══════════════════════════════════════════════════════════════════
//  KilnScan Pro v5 — Motor matemático y de visualización
//
//  MODELO DE DATOS:
//    Horno → N llantas (default 3)
//    Cada llanta → { virola, rodillo_izq, rodillo_der }
//    Cada componente → { puntos[], inputMode, unit }
//    Punto polar (estación total): { aV, aH, dist }
//      aV  = ángulo vertical   (grados)
//      aH  = ángulo horizontal (grados)
//      dist = distancia medida (en la unidad seleccionada)
//    Punto cartesiano: { x, y }  (en la unidad seleccionada)
//
//  INTERNAMENTE: todo se almacena y calcula en mm
// ═══════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────
//  1. UNIDADES
// ─────────────────────────────────────────────────────────────────
const UNIT_FACTORS = { mm: 1, cm: 10, m: 1000 };

function toMM(v, unit)   { return v * (UNIT_FACTORS[unit] || 1); }
function fromMM(v, unit) { return v / (UNIT_FACTORS[unit] || 1); }

// ─────────────────────────────────────────────────────────────────
//  2. ESTACIÓN TOTAL → CARTESIANO (proyección horizontal)
//     ángulo V = ángulo vertical   (0° = zenith, 90° = horizontal)
//     ángulo H = ángulo horizontal (0–360°)
//     dist    = distancia inclinada
//
//     Proyección plana (sección transversal del horno):
//       d_h = dist * sin(aV)   ← componente horizontal
//       x   = d_h * cos(aH)
//       y   = d_h * sin(aH)
//
//     NOTA: si los datos ya vienen como radio directo en campo,
//     usar aV = 90° (sin(90°) = 1 → d_h = dist)
// ─────────────────────────────────────────────────────────────────
function stationToCart(aV_deg, aH_deg, dist_mm) {
  const aV = aV_deg * Math.PI / 180;
  const aH = aH_deg * Math.PI / 180;
  const dh = dist_mm * Math.sin(aV);   // distancia horizontal
  return { x: dh * Math.cos(aH), y: dh * Math.sin(aH) };
}

// ─────────────────────────────────────────────────────────────────
//  3. CONVERTIR PUNTOS A CARTESIANOS EN MM
// ─────────────────────────────────────────────────────────────────
function ptsToCartMM(points, inputMode, unit) {
  if (!points || !points.length) return [];
  const out = [];
  if (inputMode === 'station') {
    // estación total: { aV, aH, dist }
    for (const p of points) {
      if (p.aV === undefined || p.aH === undefined || p.dist === undefined) continue;
      const dist_mm = toMM(p.dist, unit);
      out.push(stationToCart(p.aV, p.aH, dist_mm));
    }
  } else {
    // cartesiano: { x, y }
    for (const p of points) {
      if (p.x === undefined || p.y === undefined) continue;
      out.push({ x: toMM(p.x, unit), y: toMM(p.y, unit) });
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────
//  4. TAUBIN CIRCULAR FIT
//     Más robusto que Kasa con datos industriales de escala grande
//     Referencia: Taubin 1991, IEEE Trans. PAMI
// ─────────────────────────────────────────────────────────────────
function taubinFit(pts) {
  const n = pts.length;
  if (n < 3) return null;

  // Centrar para estabilidad numérica
  const mx = pts.reduce((s,p) => s+p.x, 0) / n;
  const my = pts.reduce((s,p) => s+p.y, 0) / n;
  const P  = pts.map(p => ({ x: p.x-mx, y: p.y-my }));

  let Mxx=0,Myy=0,Mxy=0,Mxz=0,Myz=0,Mzz=0;
  for (const p of P) {
    const z = p.x*p.x + p.y*p.y;
    Mxx+=p.x*p.x; Myy+=p.y*p.y; Mxy+=p.x*p.y;
    Mxz+=p.x*z;   Myz+=p.y*z;   Mzz+=z*z;
  }
  Mxx/=n; Myy/=n; Mxy/=n; Mxz/=n; Myz/=n; Mzz/=n;

  const Mz       = Mxx+Myy;
  const Cov_xy   = Mxx*Myy - Mxy*Mxy;
  const Var_z    = Mzz - Mz*Mz;
  const A3=4*Mz, A2=-3*Mz*Mz-Mzz;
  const A1=Var_z*Mz+4*Cov_xy*Mz-Mxz*Mxz-Myz*Myz;
  const A0=Mxz*(Mxz*Myy-Myz*Mxy)+Myz*(Myz*Mxx-Mxz*Mxy)-Var_z*Cov_xy;

  let xn=0, yn=1e20;
  for (let i=0; i<99; i++) {
    const yo = yn;
    yn = A0 + xn*(A1 + xn*(A2 + xn*A3));
    if (Math.abs(yn) > Math.abs(yo)) { xn=0; break; }
    const Dy = A1 + xn*(2*A2 + xn*3*A3);
    const xo = xn; xn = xo - yn/Dy;
    if (Math.abs((xn-xo)/xn) < 1e-12) break;
  }

  const DET = xn*xn - xn*Mz + Cov_xy;
  if (Math.abs(DET) < 1e-10) return kasaFit(pts);

  const cxc = (Mxz*(Myy-xn) - Myz*Mxy) / (2*DET);
  const cyc = (Myz*(Mxx-xn) - Mxz*Mxy) / (2*DET);
  const cx  = cxc + mx, cy = cyc + my;
  const r   = Math.sqrt(cxc*cxc + cyc*cyc + Mz);
  return buildResult(pts, cx, cy, r);
}

// ─────────────────────────────────────────────────────────────────
//  5. KASA FALLBACK
// ─────────────────────────────────────────────────────────────────
function kasaFit(pts) {
  const n=pts.length;
  let sX=0,sY=0,sX2=0,sY2=0,sXY=0,sX3=0,sY3=0,sX2Y=0,sXY2=0;
  for (const p of pts) {
    const x=p.x,y=p.y,x2=x*x,y2=y*y;
    sX+=x;sY+=y;sX2+=x2;sY2+=y2;sXY+=x*y;
    sX3+=x2*x;sY3+=y2*y;sX2Y+=x2*y;sXY2+=x*y2;
  }
  const d3=(m)=>m[0]*(m[4]*m[8]-m[5]*m[7])-m[1]*(m[3]*m[8]-m[5]*m[6])+m[2]*(m[3]*m[7]-m[4]*m[6]);
  const M=[sX2,sXY,sX,sXY,sY2,sY,sX,sY,n];
  const D=d3(M); if(Math.abs(D)<1e-10) return null;
  const b1=sX3+sXY2, b2=sX2Y+sY3, b3=sX2+sY2;
  const c1=d3([b1,sXY,sX,b2,sY2,sY,b3,sY,n])/D;
  const c2=d3([sX2,b1,sX,sXY,b2,sY,sX,b3,n])/D;
  const c3=d3([sX2,sXY,b1,sXY,sY2,b2,sX,sY,b3])/D;
  const cx=c1/2, cy=c2/2, r=Math.sqrt(c3+cx*cx+cy*cy);
  return buildResult(pts,cx,cy,r);
}

// ─────────────────────────────────────────────────────────────────
//  6. BUILD RESULT
// ─────────────────────────────────────────────────────────────────
function buildResult(pts, cx, cy, r) {
  const residuals = pts.map(p => Math.sqrt((p.x-cx)**2+(p.y-cy)**2) - r);
  const rmse = Math.sqrt(residuals.reduce((s,e)=>s+e*e,0)/pts.length);
  const radii = pts.map(p => Math.sqrt((p.x-cx)**2+(p.y-cy)**2));
  const dmax=Math.max(...radii), dmin=Math.min(...radii);
  return {
    cx, cy, r, diameter: r*2,
    dmax, dmin,
    ovalityPct: r>0 ? ((dmax-dmin)/r)*100 : 0,
    eccentricity: Math.sqrt(cx*cx+cy*cy),
    residuals, rmse, n: pts.length
  };
}

// ─────────────────────────────────────────────────────────────────
//  7. CALCULAR MÉTRICAS DE UN COMPONENTE (virola o rodillo)
// ─────────────────────────────────────────────────────────────────
function calcMetrics(component) {
  const mode = component.inputMode || 'station';
  const unit = component.unit || 'mm';
  const pts  = component.points || [];
  const empty = { ovalityPct:0, dmax:0, dmin:0, cx:0, cy:0, r:0, diameter:0, rmse:0, eccentricity:0, fit:null };
  if (!pts.length) return empty;
  const cartPts = ptsToCartMM(pts, mode, unit);
  if (cartPts.length < 3) return empty;
  const fit = taubinFit(cartPts);
  if (!fit) return empty;
  return { ...fit, fit, cartPts };
}

// ─────────────────────────────────────────────────────────────────
//  8. MÉTRICAS DE UNA LLANTA COMPLETA
//     returns { virola, rodIzq, rodDer }
// ─────────────────────────────────────────────────────────────────
function calcTireFullMetrics(tire) {
  return {
    virola:  calcMetrics(tire.virola  || {}),
    rodIzq:  calcMetrics(tire.rodIzq  || {}),
    rodDer:  calcMetrics(tire.rodDer  || {})
  };
}

// ─────────────────────────────────────────────────────────────────
//  9. MÁXIMA OVALIDAD DE UN PROYECTO
// ─────────────────────────────────────────────────────────────────
function maxOvalityProject(project) {
  const tires = project.tires || {};
  let mx = 0;
  for (const t of Object.values(tires)) {
    const m = calcMetrics(t.virola || {});
    if (m.ovalityPct > mx) mx = m.ovalityPct;
  }
  return mx;
}

function projectStatusLevel(project) {
  const mx   = maxOvalityProject(project);
  const warn = project.warnThreshold || 0.5;
  const crit = project.critThreshold || 1.0;
  return mx > crit ? 'crit' : mx > warn ? 'warn' : 'ok';
}

// ─────────────────────────────────────────────────────────────────
//  10. COLORES
// ─────────────────────────────────────────────────────────────────
function ovColor(pct, project) {
  const warn = project?.warnThreshold || 0.5;
  const crit = project?.critThreshold || 1.0;
  return pct > crit ? '#ff4444' : pct > warn ? '#f5c518' : '#22dd6a';
}
function hexA(hex, a) {
  if (!hex || hex.length<7) return `rgba(120,120,120,${a})`;
  return `rgba(${parseInt(hex.slice(1,3),16)},${parseInt(hex.slice(3,5),16)},${parseInt(hex.slice(5,7),16)},${a})`;
}

// ─────────────────────────────────────────────────────────────────
//  11. DIBUJAR CILINDRO DEL HORNO (vista longitudinal inclinada)
//      Las llantas se marcan con aro naranja
//      Rodillos de apoyo se dibujan debajo de cada llanta
// ─────────────────────────────────────────────────────────────────
function drawKilnCylinder(canvas, project, activeTire, height, onClick) {
  if (!canvas) return;
  const W = canvas.offsetWidth || 700;
  canvas.width = W; canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, W, height);

  const tires   = project.tires || {};
  const ntires  = project.ntires || 3;
  const incl    = project.inclination || 3.5;
  const rad     = incl * Math.PI / 180;
  const mL=50, mR=50;
  const totalW  = W - mL - mR;
  const segW    = totalW / ntires;
  const cylH    = height * 0.38;
  const midBase = height * 0.44;

  function axisY(x) {
    return midBase - (x - mL) * Math.tan(rad) * 0.4;
  }
  function eryScale(i) {
    const t = i / Math.max(ntires-1, 1);
    return cylH * (0.70 + 0.30*(1-t));
  }
  function segX(i) { return mL + i*segW; }

  // Fondo
  ctx.fillStyle='#07090c'; ctx.fillRect(0,0,W,height);

  // Eje punteado
  ctx.strokeStyle='#1a2336'; ctx.lineWidth=0.6; ctx.setLineDash([5,5]);
  ctx.beginPath(); ctx.moveTo(mL, axisY(mL)); ctx.lineTo(W-mR, axisY(W-mR));
  ctx.stroke(); ctx.setLineDash([]);

  // Dibujar segmentos entre llantas (cuerpo del horno)
  for (let i=ntires-1; i>=0; i--) {
    const tire   = tires[i] || {};
    const m      = calcMetrics(tire.virola || {});
    const ov     = m.ovalityPct;
    const col    = ovColor(ov, project);
    const x0=segX(i), x1=segX(i+1);
    const y0=axisY(x0+(x1-x0)*0), y1=axisY(x0+(x1-x0)*1);
    const ry0=eryScale(i), ry1=eryScale(i+1);
    const rx=segW*0.09;
    const isAct = i === activeTire;

    // Cara lateral
    const grad = ctx.createLinearGradient(x0, y0-ry0, x0, y0+ry0);
    grad.addColorStop(0,   hexA(col, isAct?0.28:0.11));
    grad.addColorStop(0.5, hexA(col, isAct?0.10:0.04));
    grad.addColorStop(1,   hexA(col, isAct?0.28:0.11));
    ctx.beginPath();
    ctx.moveTo(x0, y0-ry0); ctx.lineTo(x1, y1-ry1);
    ctx.ellipse(x1, y1, rx, ry1, 0, -Math.PI/2, Math.PI/2);
    ctx.lineTo(x0, y0+ry0);
    ctx.ellipse(x0, y0, rx, ry0, 0, Math.PI/2, -Math.PI/2);
    ctx.closePath();
    ctx.fillStyle=grad; ctx.fill();

    // Bordes superior e inferior
    ctx.strokeStyle=hexA(col, isAct?0.9:0.28); ctx.lineWidth=isAct?1.8:0.7;
    ctx.beginPath(); ctx.moveTo(x0,y0-ry0); ctx.lineTo(x1,y1-ry1); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x0,y0+ry0); ctx.lineTo(x1,y1+ry1); ctx.stroke();

    // Elipse cara derecha
    ctx.beginPath(); ctx.ellipse(x1,y1,rx,ry1,0,0,Math.PI*2);
    ctx.fillStyle=hexA(col,0.06); ctx.fill();
    ctx.strokeStyle=hexA(col,isAct?0.6:0.20); ctx.lineWidth=isAct?1.2:0.5; ctx.stroke();

    if (i===0) {
      ctx.beginPath(); ctx.ellipse(x0,y0,rx,ry0,0,0,Math.PI*2);
      ctx.fillStyle=hexA(col,0.04); ctx.fill();
      ctx.strokeStyle=hexA(col,0.3); ctx.lineWidth=0.5; ctx.stroke();
    }
  }

  // Dibujar LLANTAS (aros naranjas sobre el cilindro) y RODILLOS debajo
  for (let i=0; i<ntires; i++) {
    const tire  = tires[i] || {};
    const midX  = segX(i) + segW*0.5;
    const midY  = axisY(midX);
    const ry    = (eryScale(i)+eryScale(i+1))/2;
    const rx    = segW*0.09;
    const isAct = i === activeTire;
    const m     = calcMetrics(tire.virola || {});
    const ov    = m.ovalityPct;
    const col   = ovColor(ov, project);

    // Aro de llanta (naranja/ámbar)
    ctx.shadowColor='rgba(255,160,40,0.5)'; ctx.shadowBlur=isAct?12:5;
    ctx.beginPath(); ctx.ellipse(midX, midY, rx*1.35, ry+3, 0, 0, Math.PI*2);
    ctx.strokeStyle=isAct?'rgba(255,160,40,0.95)':'rgba(255,160,40,0.50)';
    ctx.lineWidth=isAct?2.5:1.2; ctx.stroke();
    ctx.shadowBlur=0;

    // Rodillos (dos galetes debajo)
    const nomRodMM = tire.rodIzq?.nomDiam || 900;
    const nomCylMM = project.diam || 4200;
    const rodScale = (nomRodMM/nomCylMM)*(ry*0.7);
    const gapX = rx*2.2;

    [-1,1].forEach((side,idx) => {
      const gx = midX + side*gapX;
      const gy = midY + ry + rodScale*0.85 + 4;
      const hasData = idx===0 ? (tire.rodIzq?.points||[]).length>0 : (tire.rodDer?.points||[]).length>0;
      const mRod = idx===0 ? calcMetrics(tire.rodIzq||{}) : calcMetrics(tire.rodDer||{});
      const rodCol = mRod.fit ? ovColor(mRod.ovalityPct, project) : '#334466';

      ctx.beginPath(); ctx.ellipse(gx, gy, rodScale*0.85, rodScale*0.4, 0, 0, Math.PI*2);
      ctx.fillStyle=hexA(rodCol, hasData?0.12:0.05); ctx.fill();
      ctx.strokeStyle=hasData?hexA(rodCol,0.7):'#1a2840'; ctx.lineWidth=hasData?1.2:0.5; ctx.stroke();

      // Label rodillo
      ctx.fillStyle=hasData?rodCol:'#253048';
      ctx.font=`500 8px DM Mono,monospace`; ctx.textAlign='center';
      ctx.fillText(`R${idx+1}`, gx, gy+3);
    });

    // % ovalidad de la virola
    ctx.fillStyle=isAct?'#00d4ff':col;
    ctx.font=`${isAct?600:500} ${isAct?11:9}px DM Mono,monospace`; ctx.textAlign='center';
    ctx.fillText(`${ov.toFixed(2)}%`, midX, midY - ry*0.45);

    // Label llanta
    ctx.fillStyle=isAct?'#00d4ff':'#202e48';
    ctx.font=`700 10px Barlow Condensed,sans-serif`; ctx.textAlign='center';
    ctx.fillText(`L${i+1}`, midX, midY + ry*0.55 + 14);

    // Highlight activo
    if (isAct) {
      ctx.shadowColor='#00d4ff'; ctx.shadowBlur=14;
      ctx.strokeStyle='rgba(0,212,255,0.8)'; ctx.lineWidth=2;
      const x0=segX(i), x1=segX(i+1);
      const y0=axisY(x0), y1=axisY(x1);
      const ry0=eryScale(i), ry1=eryScale(i+1);
      ctx.beginPath(); ctx.moveTo(x0,y0-ry0); ctx.lineTo(x1,y1-ry1); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x0,y0+ry0); ctx.lineTo(x1,y1+ry1); ctx.stroke();
      ctx.shadowBlur=0;
    }
  }

  // Labels entrada/salida
  ctx.fillStyle='#1e2840'; ctx.font='9px Barlow,sans-serif'; ctx.textAlign='center';
  ctx.fillText('ENTRADA', mL/2, midBase+4);
  ctx.fillText('SALIDA', W-mR/2, midBase+4);

  // Click
  canvas.onclick = e => {
    const rect=canvas.getBoundingClientRect();
    const mx=(e.clientX-rect.left)*(W/rect.width);
    for (let i=0; i<ntires; i++) {
      const cx=segX(i)+segW*0.5;
      if (Math.abs(mx-cx)<segW*0.6) { if(onClick) onClick(i); break; }
    }
  };
}

// ─────────────────────────────────────────────────────────────────
//  12. DIBUJAR SECCIÓN TRANSVERSAL DE UN COMPONENTE
//      Muestra la virola + los dos rodillos alrededor (si tienen datos)
// ─────────────────────────────────────────────────────────────────
function drawSectionChart(canvas, tire, project) {
  if (!canvas) return;
  const W=canvas.offsetWidth||420, H=canvas.height||440;
  canvas.width=W;
  const ctx=canvas.getContext('2d');
  ctx.clearRect(0,0,W,H);
  ctx.fillStyle='#07090f'; ctx.fillRect(0,0,W,H);

  const cx=W/2, cy=H*0.46;
  const maxR=Math.min(W,H)*0.35;
  const dnom=project.diam||4200; // mm nominal

  const mVirola = calcMetrics(tire.virola||{});
  const mRodIzq = calcMetrics(tire.rodIzq||{});
  const mRodDer = calcMetrics(tire.rodDer||{});

  const fitR  = mVirola.fit ? mVirola.r  : dnom/2;
  const fitCx = mVirola.fit ? mVirola.cx : 0;
  const fitCy = mVirola.fit ? mVirola.cy : 0;

  const scale = r => (r / (fitR*1.16)) * maxR;

  // ── Grid anillos ──
  [0.82,0.88,0.94,1.0,1.06,1.12,1.16].forEach(f=>{
    const isNom = Math.abs(f-1.0)<0.001;
    ctx.beginPath(); ctx.arc(cx,cy,scale(fitR*f),0,Math.PI*2);
    ctx.strokeStyle=isNom?'rgba(0,212,255,0.18)':'#0e1520';
    ctx.lineWidth=isNom?1.2:0.35;
    ctx.setLineDash(isNom?[5,3]:[2,5]); ctx.stroke(); ctx.setLineDash([]);
  });

  // Guías radiales
  for(let a=0;a<360;a+=15) {
    const r2=a%30===0?scale(fitR*1.16):scale(fitR*1.08);
    const ra=a*Math.PI/180;
    ctx.beginPath(); ctx.moveTo(cx,cy);
    ctx.lineTo(cx+r2*Math.cos(ra),cy+r2*Math.sin(ra));
    ctx.strokeStyle=a%30===0?'#0e1828':'#090e18'; ctx.lineWidth=0.25; ctx.stroke();
  }
  // Labels angulares
  [0,45,90,135,180,225,270,315].forEach(a=>{
    const ra=a*Math.PI/180, lr=scale(fitR*1.16)+13;
    ctx.fillStyle='#1e2a40'; ctx.font='9px DM Mono,monospace';
    ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText(a+'°',cx+lr*Math.cos(ra),cy+lr*Math.sin(ra));
  });

  // Círculo nominal
  ctx.beginPath(); ctx.arc(cx,cy,scale(dnom/2),0,Math.PI*2);
  ctx.strokeStyle='rgba(80,100,180,0.28)'; ctx.lineWidth=1;
  ctx.setLineDash([6,4]); ctx.stroke(); ctx.setLineDash([]);

  // ── RODILLOS (si tienen datos) ──
  const rodOffset = scale(fitR)*1.18;
  [[mRodIzq, Math.PI, 'R.Izq','#ff9a30'], [mRodDer, 0, 'R.Der','#ff9a30']].forEach(([mRod,ang,lbl,rcol])=>{
    if (!mRod.fit) {
      // Rodillo sin datos: solo círculo gris de referencia
      const rRod = scale((tire.rodIzq?.nomDiam||900)/2);
      const rx=cx+rodOffset*Math.cos(ang), ry2=cy+rodOffset*Math.sin(ang);
      ctx.beginPath(); ctx.arc(rx,ry2,rRod,0,Math.PI*2);
      ctx.strokeStyle='rgba(40,55,85,0.6)'; ctx.lineWidth=0.8;
      ctx.setLineDash([3,4]); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle='#1a2438'; ctx.font='9px Barlow Condensed,monospace'; ctx.textAlign='center';
      ctx.fillText(lbl,rx,ry2);
    } else {
      const rRod=scale(mRod.r);
      const rcx=cx+(mRod.cx?(scale(mRod.cx)+rodOffset)*Math.cos(ang):rodOffset*Math.cos(ang));
      const rcy=cy+(mRod.cy?(scale(mRod.cy)+rodOffset)*Math.sin(ang):rodOffset*Math.sin(ang));
      // Relleno
      ctx.beginPath(); ctx.arc(rcx,rcy,rRod,0,Math.PI*2);
      ctx.fillStyle=hexA(rcol,0.07); ctx.fill();
      // Borde
      ctx.strokeStyle=hexA(rcol,0.65); ctx.lineWidth=1.4; ctx.stroke();
      // Puntos del rodillo
      mRod.cartPts?.forEach(p=>{
        const px=rcx+scale(p.x-mRod.cx||p.x), py=rcy+scale(p.y-mRod.cy||p.y);
        ctx.beginPath(); ctx.arc(px,py,3.5,0,Math.PI*2);
        ctx.fillStyle=rcol; ctx.fill();
        ctx.strokeStyle='#07090f'; ctx.lineWidth=1; ctx.stroke();
      });
      // Label
      ctx.fillStyle=rcol; ctx.font='9px Barlow Condensed,sans-serif'; ctx.textAlign='center';
      ctx.fillText(`${lbl} Ø${fromMM(mRod.diameter, tire.rodIzq?.unit||'mm').toFixed(1)}`,rcx,rcy-rRod-6);
    }
  });

  // ── VIROLA ──
  if (!mVirola.fit) {
    ctx.fillStyle='#253048'; ctx.font='13px Barlow,sans-serif'; ctx.textAlign='center';
    ctx.fillText('Sin puntos — ingresa mediciones en la Virola', cx, cy);
    drawInfoBox(ctx,W,H,null,null,project,tire.virola?.unit||'mm');
    return;
  }
  const ov  = mVirola.ovalityPct;
  const col = ovColor(ov, project);

  // Círculo ajustado (Taubin)
  const fitCxS=cx+scale(fitCx), fitCyS=cy+scale(fitCy);
  ctx.beginPath(); ctx.arc(fitCxS,fitCyS,scale(fitR),0,Math.PI*2);
  ctx.strokeStyle=col; ctx.lineWidth=2; ctx.globalAlpha=0.75; ctx.stroke(); ctx.globalAlpha=1;
  ctx.beginPath(); ctx.arc(fitCxS,fitCyS,scale(fitR),0,Math.PI*2);
  ctx.fillStyle=hexA(col,0.05); ctx.fill();

  // Puntos medidos
  mVirola.cartPts?.forEach((p,i)=>{
    const px=cx+scale(p.x), py=cy+scale(p.y);
    const dist=Math.sqrt((p.x-fitCx)**2+(p.y-fitCy)**2);
    const dev=dist-fitR;
    const dotCol=Math.abs(dev)>fitR*0.006
      ?(dev>0?'#ff5252':'#5599ff')
      :'#22dd6a';

    // Línea residual
    const ang=Math.atan2(p.y-fitCy,p.x-fitCx);
    const circX=fitCxS+scale(fitR)*Math.cos(ang);
    const circY=fitCyS+scale(fitR)*Math.sin(ang);
    ctx.beginPath(); ctx.moveTo(circX,circY); ctx.lineTo(px,py);
    ctx.strokeStyle=hexA(dotCol,0.45); ctx.lineWidth=0.8; ctx.stroke();

    // Punto con glow
    ctx.shadowColor=dotCol; ctx.shadowBlur=7;
    ctx.beginPath(); ctx.arc(px,py,5,0,Math.PI*2);
    ctx.fillStyle=dotCol; ctx.fill();
    ctx.strokeStyle='#07090f'; ctx.lineWidth=1.5; ctx.shadowBlur=0; ctx.stroke();

    // Número de punto
    const lr=Math.sqrt((px-cx)**2+(py-cy)**2)+15;
    const la=Math.atan2(py-cy,px-cx);
    ctx.fillStyle='#2e4060'; ctx.font='9px DM Mono,monospace';
    ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText(`P${i+1}`,cx+lr*Math.cos(la),cy+lr*Math.sin(la));
  });

  // Cruz centro ajustado (cian)
  ctx.shadowColor='#00d4ff'; ctx.shadowBlur=7;
  ctx.strokeStyle='rgba(0,212,255,0.9)'; ctx.lineWidth=1.2;
  ctx.beginPath(); ctx.moveTo(fitCxS-9,fitCyS); ctx.lineTo(fitCxS+9,fitCyS); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(fitCxS,fitCyS-9); ctx.lineTo(fitCxS,fitCyS+9); ctx.stroke();
  ctx.beginPath(); ctx.arc(fitCxS,fitCyS,2.5,0,Math.PI*2);
  ctx.fillStyle='#00d4ff'; ctx.fill(); ctx.shadowBlur=0;

  // Cruz centro nominal (azul)
  ctx.strokeStyle='rgba(80,100,180,0.45)'; ctx.lineWidth=0.8;
  ctx.beginPath(); ctx.moveTo(cx-6,cy); ctx.lineTo(cx+6,cy); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx,cy-6); ctx.lineTo(cx,cy+6); ctx.stroke();

  // Info box y leyenda
  drawInfoBox(ctx,W,H,mVirola,col,project,tire.virola?.unit||'mm');
}

function drawInfoBox(ctx,W,H,m,col,project,unit) {
  const ibX=8,ibY=H-88,ibW=185,ibH=82;
  ctx.fillStyle='rgba(7,9,15,0.85)'; ctx.fillRect(ibX,ibY,ibW,ibH);
  ctx.strokeStyle='#1a2438'; ctx.lineWidth=0.5; ctx.strokeRect(ibX,ibY,ibW,ibH);
  ctx.font='10px DM Mono,monospace'; ctx.textAlign='left'; ctx.textBaseline='top';
  if (m && m.fit) {
    const c=col||'#22dd6a';
    ctx.fillStyle=c;
    ctx.fillText(`Ovalidad: ${m.ovalityPct.toFixed(5)}%`,ibX+7,ibY+7);
    ctx.fillStyle='#2e4a6a';
    ctx.fillText(`R: ${fromMM(m.r,unit).toFixed(4)} ${unit}`,ibX+7,ibY+22);
    ctx.fillText(`Ø: ${fromMM(m.diameter,unit).toFixed(4)} ${unit}`,ibX+7,ibY+36);
    ctx.fillText(`Centro (${fromMM(m.cx,unit).toFixed(3)}, ${fromMM(m.cy,unit).toFixed(3)})`,ibX+7,ibY+50);
    ctx.fillText(`RMSE: ${m.rmse.toFixed(4)} mm  n=${m.n}`,ibX+7,ibY+64);
  } else {
    ctx.fillStyle='#2e4060'; ctx.fillText('Sin datos suficientes',ibX+7,ibY+28);
  }
  // Leyenda
  ctx.font='10px Barlow,sans-serif'; ctx.textAlign='left'; ctx.textBaseline='alphabetic';
  ctx.fillStyle='rgba(0,212,255,0.55)';  ctx.fillText('─── Virola ajustada (Taubin)',W-175,H-50);
  ctx.fillStyle='rgba(80,100,180,0.45)'; ctx.fillText('─ ─ Diám. nominal',W-175,H-35);
  ctx.fillStyle='rgba(255,154,48,0.6)';  ctx.fillText('◎ Rodillos de apoyo',W-175,H-20);
}

// ─────────────────────────────────────────────────────────────────
//  13. DEMO DATA
// ─────────────────────────────────────────────────────────────────
function genDemoTire(diam_mm, ovalPct, rodDiam_mm=900) {
  const r=diam_mm/2, stretch=r*ovalPct/100/2;
  const n=6;
  const virola_pts=[];
  for(let i=0;i<n;i++){
    const a=(i/n)*2*Math.PI+(Math.random()-.5)*0.1;
    // Generar en formato estación total (aV=90°, aH=a*180/π, dist=radio)
    const rx=r+stretch*Math.cos(2*a)+(Math.random()-.5)*1.5;
    virola_pts.push({aV:90, aH:((a*180/Math.PI)+360)%360, dist:parseFloat(rx.toFixed(3))});
  }
  const makeRodPts=(rd)=>{
    const rr=rd/2; const pts=[];
    for(let i=0;i<4;i++){
      const a=(i/4)*2*Math.PI;
      const dist=rr+(Math.random()-.5)*0.5;
      pts.push({aV:90, aH:((a*180/Math.PI)+360)%360, dist:parseFloat(dist.toFixed(3))});
    }
    return pts;
  };
  return {
    virola: { inputMode:'station', unit:'mm', nomDiam:diam_mm, points:virola_pts },
    rodIzq: { inputMode:'station', unit:'mm', nomDiam:rodDiam_mm, points:makeRodPts(rodDiam_mm) },
    rodDer: { inputMode:'station', unit:'mm', nomDiam:rodDiam_mm, points:makeRodPts(rodDiam_mm) }
  };
}

// Export
window.KS = {
  toMM, fromMM,
  stationToCart, ptsToCartMM,
  taubinFit, kasaFit,
  calcMetrics, calcTireFullMetrics,
  maxOvalityProject, projectStatusLevel,
  ovColor, hexA,
  drawKilnCylinder, drawSectionChart,
  genDemoTire
};
