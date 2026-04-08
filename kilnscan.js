// ═══════════════════════════════════════════════════════════════════
//  KilnScan Pro v6 — Motor matemático y de visualización
//  FIXES v6:
//   - Gráfica completamente visible: polígono de cuerdas, colores sólidos
//   - Rodillos en posición correcta: 45° y 135° (abajo)
//   - Escala adaptativa basada en datos reales
//   - Radio↔Diámetro funciona correctamente
//   - Inputs reactivos con oninput
// ═══════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────
//  1. UNIDADES
// ─────────────────────────────────────────────────────────────────
const UNIT_FACTORS = { mm: 1, cm: 10, m: 1000 };
function toMM(v, unit)   { return v * (UNIT_FACTORS[unit] || 1); }
function fromMM(v, unit) { return v / (UNIT_FACTORS[unit] || 1); }

// ─────────────────────────────────────────────────────────────────
//  2. ESTACIÓN TOTAL → CARTESIANO
//     aV = ángulo vertical (90° = horizontal → sin(90°)=1 → dist=radio)
//     aH = ángulo horizontal (0–360°)
//     dist = distancia medida (en mm)
// ─────────────────────────────────────────────────────────────────
function stationToCart(aV_deg, aH_deg, dist_mm) {
  const aV = aV_deg * Math.PI / 180;
  const aH = aH_deg * Math.PI / 180;
  const dh = dist_mm * Math.sin(aV);
  return { x: dh * Math.cos(aH), y: dh * Math.sin(aH) };
}

// ─────────────────────────────────────────────────────────────────
//  3. CONVERTIR PUNTOS A CARTESIANOS EN MM
// ─────────────────────────────────────────────────────────────────
function ptsToCartMM(points, inputMode, unit) {
  if (!points || !points.length) return [];
  const out = [];
  if (inputMode === 'station') {
    for (const p of points) {
      if (p.aV === undefined || p.aH === undefined || p.dist === undefined) continue;
      const dist_mm = toMM(p.dist, unit);
      const c = stationToCart(p.aV, p.aH, dist_mm);
      if (isFinite(c.x) && isFinite(c.y)) out.push(c);
    }
  } else {
    for (const p of points) {
      if (p.x === undefined || p.y === undefined) continue;
      const xmm = toMM(p.x, unit), ymm = toMM(p.y, unit);
      if (isFinite(xmm) && isFinite(ymm)) out.push({ x: xmm, y: ymm });
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────
//  4. TAUBIN CIRCULAR FIT
// ─────────────────────────────────────────────────────────────────
function taubinFit(pts) {
  const n = pts.length;
  if (n < 3) return null;
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
  const Mz=Mxx+Myy, Cov_xy=Mxx*Myy-Mxy*Mxy, Var_z=Mzz-Mz*Mz;
  const A3=4*Mz, A2=-3*Mz*Mz-Mzz;
  const A1=Var_z*Mz+4*Cov_xy*Mz-Mxz*Mxz-Myz*Myz;
  const A0=Mxz*(Mxz*Myy-Myz*Mxy)+Myz*(Myz*Mxx-Mxz*Mxy)-Var_z*Cov_xy;
  let xn=0, yn=1e20;
  for (let i=0; i<99; i++) {
    const yo=yn;
    yn=A0+xn*(A1+xn*(A2+xn*A3));
    if (Math.abs(yn)>Math.abs(yo)){xn=0;break;}
    const Dy=A1+xn*(2*A2+xn*3*A3);
    const xo=xn; xn=xo-yn/Dy;
    if (Math.abs((xn-xo)/xn)<1e-12) break;
  }
  const DET=xn*xn-xn*Mz+Cov_xy;
  if (Math.abs(DET)<1e-10) return kasaFit(pts);
  const cxc=(Mxz*(Myy-xn)-Myz*Mxy)/(2*DET);
  const cyc=(Myz*(Mxx-xn)-Mxz*Mxy)/(2*DET);
  const cx=cxc+mx, cy=cyc+my;
  const r=Math.sqrt(cxc*cxc+cyc*cyc+Mz);
  if (!isFinite(r) || r<=0) return kasaFit(pts);
  return buildResult(pts,cx,cy,r);
}

// ─────────────────────────────────────────────────────────────────
//  5. KASA FALLBACK
// ─────────────────────────────────────────────────────────────────
function kasaFit(pts) {
  const n=pts.length;
  let sX=0,sY=0,sX2=0,sY2=0,sXY=0,sX3=0,sY3=0,sX2Y=0,sXY2=0;
  for(const p of pts){const x=p.x,y=p.y,x2=x*x,y2=y*y;sX+=x;sY+=y;sX2+=x2;sY2+=y2;sXY+=x*y;sX3+=x2*x;sY3+=y2*y;sX2Y+=x2*y;sXY2+=x*y2;}
  const d3=(m)=>m[0]*(m[4]*m[8]-m[5]*m[7])-m[1]*(m[3]*m[8]-m[5]*m[6])+m[2]*(m[3]*m[7]-m[4]*m[6]);
  const M=[sX2,sXY,sX,sXY,sY2,sY,sX,sY,n];
  const D=d3(M); if(Math.abs(D)<1e-10) return null;
  const b1=sX3+sXY2,b2=sX2Y+sY3,b3=sX2+sY2;
  const c1=d3([b1,sXY,sX,b2,sY2,sY,b3,sY,n])/D;
  const c2=d3([sX2,b1,sX,sXY,b2,sY,sX,b3,n])/D;
  const c3=d3([sX2,sXY,b1,sXY,sY2,b2,sX,sY,b3])/D;
  const cx=c1/2,cy=c2/2,r=Math.sqrt(c3+cx*cx+cy*cy);
  if(!isFinite(r)||r<=0) return null;
  return buildResult(pts,cx,cy,r);
}

// ─────────────────────────────────────────────────────────────────
//  6. BUILD RESULT
// ─────────────────────────────────────────────────────────────────
function buildResult(pts, cx, cy, r) {
  const residuals=pts.map(p=>Math.sqrt((p.x-cx)**2+(p.y-cy)**2)-r);
  const rmse=Math.sqrt(residuals.reduce((s,e)=>s+e*e,0)/pts.length);
  const radii=pts.map(p=>Math.sqrt((p.x-cx)**2+(p.y-cy)**2));
  const dmax=Math.max(...radii), dmin=Math.min(...radii);
  return {
    cx,cy,r,diameter:r*2,dmax,dmin,
    ovalityPct:r>0?((dmax-dmin)/r)*100:0,
    eccentricity:Math.sqrt(cx*cx+cy*cy),
    residuals,rmse,n:pts.length
  };
}

// ─────────────────────────────────────────────────────────────────
//  7. MÉTRICAS DE UN COMPONENTE
// ─────────────────────────────────────────────────────────────────
function calcMetrics(component) {
  const mode=component.inputMode||'station';
  const unit=component.unit||'mm';
  const pts=component.points||[];
  const empty={ovalityPct:0,dmax:0,dmin:0,cx:0,cy:0,r:0,diameter:0,rmse:0,eccentricity:0,fit:null};
  if(!pts.length) return empty;
  const cartPts=ptsToCartMM(pts,mode,unit);
  if(cartPts.length<3) return empty;
  const fit=taubinFit(cartPts);
  if(!fit) return empty;
  return {...fit,fit,cartPts};
}

// ─────────────────────────────────────────────────────────────────
//  8. PROYECTO
// ─────────────────────────────────────────────────────────────────
function maxOvalityProject(project) {
  const tires=project.tires||{};
  let mx=0;
  for(const t of Object.values(tires)){
    const m=calcMetrics(t.virola||{});
    if(m.ovalityPct>mx) mx=m.ovalityPct;
  }
  return mx;
}
function projectStatusLevel(project) {
  const mx=maxOvalityProject(project);
  const warn=project.warnThreshold||0.5;
  const crit=project.critThreshold||1.0;
  return mx>crit?'crit':mx>warn?'warn':'ok';
}
function ovColor(pct,project) {
  const warn=project?.warnThreshold||0.5, crit=project?.critThreshold||1.0;
  return pct>crit?'#ff4444':pct>warn?'#f5c518':'#22dd6a';
}
function hexA(hex,a) {
  if(!hex||hex.length<7) return `rgba(120,120,120,${a})`;
  return `rgba(${parseInt(hex.slice(1,3),16)},${parseInt(hex.slice(3,5),16)},${parseInt(hex.slice(5,7),16)},${a})`;
}

// ─────────────────────────────────────────────────────────────────
//  9. DIBUJAR CILINDRO (vista longitudinal)
// ─────────────────────────────────────────────────────────────────
function drawKilnCylinder(canvas, project, activeTire, height, onClick) {
  if(!canvas) return;
  const W=canvas.offsetWidth||700;
  canvas.width=W; canvas.height=height;
  const ctx=canvas.getContext('2d');
  ctx.clearRect(0,0,W,height);
  const tires=project.tires||{};
  const ntires=project.ntires||3;
  const incl=(project.inclination||3.5)*Math.PI/180;
  const mL=50,mR=50,totalW=W-mL-mR;
  const segW=totalW/ntires;
  const cylH=height*0.36;
  const midBase=height*0.42;
  function axisY(x){return midBase-(x-mL)*Math.tan(incl)*0.4;}
  function ery(i){const t=i/Math.max(ntires-1,1);return cylH*(0.70+0.30*(1-t));}
  function segX(i){return mL+i*segW;}

  ctx.fillStyle='#07090c'; ctx.fillRect(0,0,W,height);
  // Eje
  ctx.strokeStyle='#1a2336'; ctx.lineWidth=0.6; ctx.setLineDash([5,5]);
  ctx.beginPath(); ctx.moveTo(mL,axisY(mL)); ctx.lineTo(W-mR,axisY(W-mR));
  ctx.stroke(); ctx.setLineDash([]);

  // Cuerpo del horno
  for(let i=ntires-1;i>=0;i--){
    const tire=tires[i]||{};
    const m=calcMetrics(tire.virola||{});
    const col=ovColor(m.ovalityPct,project);
    const x0=segX(i),x1=segX(i+1);
    const y0=axisY(x0),y1=axisY(x1);
    const ry0=ery(i),ry1=ery(i+1);
    const rx=segW*0.09;
    const isAct=i===activeTire;
    const grad=ctx.createLinearGradient(x0,y0-ry0,x0,y0+ry0);
    grad.addColorStop(0,hexA(col,isAct?0.28:0.11));
    grad.addColorStop(0.5,hexA(col,isAct?0.10:0.04));
    grad.addColorStop(1,hexA(col,isAct?0.28:0.11));
    ctx.beginPath();
    ctx.moveTo(x0,y0-ry0); ctx.lineTo(x1,y1-ry1);
    ctx.ellipse(x1,y1,rx,ry1,0,-Math.PI/2,Math.PI/2);
    ctx.lineTo(x0,y0+ry0);
    ctx.ellipse(x0,y0,rx,ry0,0,Math.PI/2,-Math.PI/2);
    ctx.closePath();
    ctx.fillStyle=grad; ctx.fill();
    ctx.strokeStyle=hexA(col,isAct?0.9:0.28); ctx.lineWidth=isAct?1.8:0.7;
    ctx.beginPath(); ctx.moveTo(x0,y0-ry0); ctx.lineTo(x1,y1-ry1); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x0,y0+ry0); ctx.lineTo(x1,y1+ry1); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(x1,y1,rx,ry1,0,0,Math.PI*2);
    ctx.fillStyle=hexA(col,0.06); ctx.fill();
    ctx.strokeStyle=hexA(col,isAct?0.6:0.20); ctx.lineWidth=isAct?1.2:0.5; ctx.stroke();
    if(i===0){
      ctx.beginPath(); ctx.ellipse(x0,y0,rx,ry0,0,0,Math.PI*2);
      ctx.fillStyle=hexA(col,0.04); ctx.fill();
      ctx.strokeStyle=hexA(col,0.3); ctx.lineWidth=0.5; ctx.stroke();
    }
  }

  // Llantas (aros naranjas) y rodillos
  for(let i=0;i<ntires;i++){
    const tire=tires[i]||{};
    const midX=segX(i)+segW*0.5;
    const midY=axisY(midX);
    const ry=(ery(i)+ery(i+1))/2;
    const rx=segW*0.09;
    const isAct=i===activeTire;
    const m=calcMetrics(tire.virola||{});
    const col=ovColor(m.ovalityPct,project);

    // Aro llanta
    ctx.shadowColor='rgba(255,160,40,0.6)'; ctx.shadowBlur=isAct?14:6;
    ctx.beginPath(); ctx.ellipse(midX,midY,rx*1.4,ry+4,0,0,Math.PI*2);
    ctx.strokeStyle=isAct?'rgba(255,160,40,1.0)':'rgba(255,160,40,0.55)';
    ctx.lineWidth=isAct?3:1.4; ctx.stroke(); ctx.shadowBlur=0;

    // Rodillos — posición 45° y 135° respecto al centro (abajo-derecha y abajo-izquierda)
    const nomRodMM=project.rodDiam||900;
    const nomCylMM=project.diam||4200;
    const rodScale=(nomRodMM/nomCylMM)*ry*0.75;
    // 45° en canvas: abajo-derecha. 135°: abajo-izquierda
    const ang45=45*Math.PI/180;
    const ang135=135*Math.PI/180;
    [[ang45,'R2'],[ang135,'R1']].forEach(([ang,lbl],idx)=>{
      // Proyectar sobre la elipse del cilindro
      const gx=midX+rx*1.3*Math.cos(ang);
      const gy=midY+ry*0.85*Math.sin(ang);
      const hasData=idx===0?(tire.rodDer?.points||[]).length>0:(tire.rodIzq?.points||[]).length>0;
      const mRod=idx===0?calcMetrics(tire.rodDer||{}):calcMetrics(tire.rodIzq||{});
      const rodCol=mRod.fit?ovColor(mRod.ovalityPct,project):'#334466';
      ctx.beginPath(); ctx.ellipse(gx,gy,rodScale*0.9,rodScale*0.45,ang,0,Math.PI*2);
      ctx.fillStyle=hexA(rodCol,hasData?0.14:0.05); ctx.fill();
      ctx.strokeStyle=hasData?hexA(rodCol,0.75):'#1a2840'; ctx.lineWidth=hasData?1.4:0.5; ctx.stroke();
      ctx.fillStyle=hasData?rodCol:'#253048';
      ctx.font='500 8px DM Mono,monospace'; ctx.textAlign='center';
      ctx.fillText(lbl,gx,gy+3);
    });

    // Texto ovalidad
    ctx.fillStyle=isAct?'#00d4ff':col;
    ctx.font=`${isAct?600:500} ${isAct?11:9}px DM Mono,monospace`; ctx.textAlign='center';
    ctx.fillText(`${m.ovalityPct.toFixed(2)}%`,midX,midY-ry*0.42);
    ctx.fillStyle=isAct?'#00d4ff':'#202e48';
    ctx.font='700 10px Barlow Condensed,sans-serif'; ctx.textAlign='center';
    ctx.fillText(`L${i+1}`,midX,midY+ry*0.55+16);
    // Barra ovalidad
    const bw=(segW-10)*Math.min(1,m.ovalityPct/2.0);
    ctx.fillStyle=hexA(col,0.15); ctx.fillRect(segX(i)+5,midY+ry*0.55+20,segW-10,3);
    ctx.fillStyle=col; ctx.fillRect(segX(i)+5,midY+ry*0.55+20,bw,3);

    // Highlight activo
    if(isAct){
      ctx.shadowColor='#00d4ff'; ctx.shadowBlur=14;
      ctx.strokeStyle='rgba(0,212,255,0.85)'; ctx.lineWidth=2;
      const x0=segX(i),x1=segX(i+1),y0=axisY(x0),y1=axisY(x1),ry0=ery(i),ry1=ery(i+1);
      ctx.beginPath(); ctx.moveTo(x0,y0-ry0); ctx.lineTo(x1,y1-ry1); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x0,y0+ry0); ctx.lineTo(x1,y1+ry1); ctx.stroke();
      ctx.shadowBlur=0;
    }
  }
  ctx.fillStyle='#1e2840'; ctx.font='9px Barlow,sans-serif'; ctx.textAlign='center';
  ctx.fillText('ENTRADA',mL/2,midBase+4); ctx.fillText('SALIDA',W-mR/2,midBase+4);
  canvas.onclick=e=>{
    const rect=canvas.getBoundingClientRect();
    const mx=(e.clientX-rect.left)*(W/rect.width);
    for(let i=0;i<ntires;i++){const cx2=segX(i)+segW*0.5;if(Math.abs(mx-cx2)<segW*0.6){if(onClick)onClick(i);break;}}
  };
}

// ─────────────────────────────────────────────────────────────────
//  10. DIBUJAR SECCIÓN TRANSVERSAL
//
//  FIX PRINCIPAL: El gráfico SIEMPRE se dibuja con escala basada
//  en los datos reales. El círculo ajustado es visible y brillante.
//  Los puntos se unen con cuerdas (polígono). Colores sólidos y fuertes.
//  Rodillos a 45° y 135° (abajo).
// ─────────────────────────────────────────────────────────────────
function drawSectionChart(canvas, tire, project) {
  if(!canvas) return;
  const W=canvas.offsetWidth||420, H=canvas.height||440;
  canvas.width=W;
  const ctx=canvas.getContext('2d');
  ctx.clearRect(0,0,W,H);
  ctx.fillStyle='#08090f'; ctx.fillRect(0,0,W,H);

  const cx=W/2, cy=H*0.44;
  // Reservar espacio abajo para rodillos
  const maxRBase=Math.min(W*0.32, H*0.30);

  const dnom=(project.diam||4200); // mm nominal del horno
  const unit=tire.virola?.unit||'mm';

  const mV=calcMetrics(tire.virola||{});
  const mRI=calcMetrics(tire.rodIzq||{});
  const mRD=calcMetrics(tire.rodDer||{});

  // ── Determinar escala ──
  // Si hay fit, usar fitR. Si no, usar nomDiam/2 en unidades del componente
  let refR_mm;
  if(mV.fit){
    refR_mm=mV.r;
  } else {
    const nomComp=tire.virola?.nomDiam||(project.diam||4200);
    refR_mm=nomComp/2;
  }
  const plotR=refR_mm>0?refR_mm:1000;
  const scale=r=>(r/plotR)*maxRBase;
  const scaleAbs=r=>Math.abs(r/plotR)*maxRBase;

  // ── FONDO CUADRÍCULA ──
  // Anillos de referencia
  [0.80,0.90,1.00,1.10,1.20].forEach(f=>{
    const isOne=Math.abs(f-1.0)<0.001;
    ctx.beginPath(); ctx.arc(cx,cy,scaleAbs(plotR*f),0,Math.PI*2);
    ctx.strokeStyle=isOne?'rgba(0,200,255,0.25)':'rgba(255,255,255,0.05)';
    ctx.lineWidth=isOne?1.5:0.5;
    ctx.setLineDash(isOne?[6,3]:[2,6]); ctx.stroke(); ctx.setLineDash([]);
  });
  // Guías radiales cada 30°
  for(let a=0;a<360;a+=30){
    const ra=a*Math.PI/180;
    const rg=scaleAbs(plotR*1.20);
    ctx.beginPath(); ctx.moveTo(cx,cy); ctx.lineTo(cx+rg*Math.cos(ra),cy+rg*Math.sin(ra));
    ctx.strokeStyle='rgba(255,255,255,0.04)'; ctx.lineWidth=0.4; ctx.stroke();
  }
  // Labels angulares
  [0,45,90,135,180,225,270,315].forEach(a=>{
    const ra=a*Math.PI/180, lr=scaleAbs(plotR*1.20)+13;
    ctx.fillStyle='rgba(255,255,255,0.25)'; ctx.font='10px DM Mono,monospace';
    ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText(a+'°',cx+lr*Math.cos(ra),cy+lr*Math.sin(ra));
  });

  // ── CÍRCULO NOMINAL (morado, visible) ──
  const nomR_mm=dnom/2;
  ctx.beginPath(); ctx.arc(cx,cy,scaleAbs(nomR_mm),0,Math.PI*2);
  ctx.strokeStyle='rgba(120,100,255,0.70)';
  ctx.lineWidth=1.8; ctx.setLineDash([8,5]); ctx.stroke(); ctx.setLineDash([]);

  // ── RODILLOS (en posición 45° y 135°, abajo) ──
  // Ángulos: 45° = abajo-derecha, 135° = abajo-izquierda (en canvas Y crece hacia abajo)
  const rodNomR_mm=(project.rodDiam||900)/2;
  const rodDist_px=scaleAbs(plotR)+scaleAbs(rodNomR_mm)+12;
  [[mRI, 135*Math.PI/180, 'Rod.Izq', tire.rodIzq?.unit||unit],
   [mRD,  45*Math.PI/180, 'Rod.Der', tire.rodDer?.unit||unit]
  ].forEach(([mRod, ang, lbl, rUnit])=>{
    const rNom_px=scaleAbs(rodNomR_mm);
    const rrx=cx+rodDist_px*Math.cos(ang);
    const rry=cy+rodDist_px*Math.sin(ang);
    if(!mRod.fit){
      // Sin datos: círculo de referencia naranja punteado
      ctx.beginPath(); ctx.arc(rrx,rry,rNom_px,0,Math.PI*2);
      ctx.strokeStyle='rgba(255,154,48,0.35)'; ctx.lineWidth=1.2;
      ctx.setLineDash([3,4]); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle='rgba(255,154,48,0.40)'; ctx.font='10px Barlow Condensed,sans-serif';
      ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.fillText(lbl,rrx,rry);
    } else {
      const rFit_px=scaleAbs(mRod.r);
      const rcol=ovColor(mRod.ovalityPct,project);
      // Relleno
      ctx.beginPath(); ctx.arc(rrx,rry,rFit_px,0,Math.PI*2);
      ctx.fillStyle=hexA(rcol,0.10); ctx.fill();
      // Borde sólido
      ctx.strokeStyle=rcol; ctx.lineWidth=2; ctx.stroke();
      // Puntos del rodillo
      if(mRod.cartPts){
        mRod.cartPts.forEach(p=>{
          const rCx=mRod.cx, rCy=mRod.cy;
          const localX=p.x-rCx, localY=p.y-rCy;
          const ppx=rrx+scaleAbs(localX), ppy=rry+scaleAbs(localY);
          ctx.beginPath(); ctx.arc(ppx,ppy,4,0,Math.PI*2);
          ctx.fillStyle=rcol; ctx.fill();
          ctx.strokeStyle='#08090f'; ctx.lineWidth=1; ctx.stroke();
        });
      }
      // Label
      ctx.fillStyle=rcol; ctx.font='bold 10px Barlow Condensed,sans-serif';
      ctx.textAlign='center';
      ctx.fillText(`${lbl} Ø${fromMM(mRod.r*2,rUnit).toFixed(2)}${rUnit}`,rrx,rry-rFit_px-8);
    }
  });

  // ── SIN FIT: mensaje y salir ──
  if(!mV.fit){
    ctx.fillStyle='rgba(255,255,255,0.30)'; ctx.font='13px Barlow,sans-serif';
    ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText('Sin puntos — ingresa mediciones en la Virola',cx,cy);
    _drawInfoBox(ctx,W,H,null,null,project,unit);
    _drawLegend(ctx,W,H);
    return;
  }

  const ov=mV.ovalityPct;
  const col=ovColor(ov,project);
  const fitCx=mV.cx, fitCy=mV.cy;
  const fitR=mV.r;

  // Centro ajustado en píxeles
  const fCxPx=cx+scale(fitCx);
  const fCyPx=cy+scale(fitCy);

  // ── CÍRCULO AJUSTADO (Taubin) — CIAN SÓLIDO ──
  ctx.shadowColor='rgba(0,212,255,0.6)'; ctx.shadowBlur=10;
  ctx.beginPath(); ctx.arc(fCxPx,fCyPx,scaleAbs(fitR),0,Math.PI*2);
  ctx.strokeStyle='#00d4ff'; ctx.lineWidth=2.5; ctx.stroke();
  ctx.shadowBlur=0;
  // Relleno translúcido
  ctx.beginPath(); ctx.arc(fCxPx,fCyPx,scaleAbs(fitR),0,Math.PI*2);
  ctx.fillStyle='rgba(0,212,255,0.04)'; ctx.fill();

  // ── PUNTOS MEDIDOS + POLÍGONO DE CUERDAS (VERDE) ──
  const cartPts=mV.cartPts;
  if(cartPts && cartPts.length>0){
    // Ordenar puntos por ángulo respecto al centro ajustado para dibujar el polígono
    const ptsOrdered=[...cartPts].sort((a,b)=>{
      const aa=Math.atan2(a.y-fitCy,a.x-fitCx);
      const ab=Math.atan2(b.y-fitCy,b.x-fitCx);
      return aa-ab;
    });

    // Calcular posiciones en píxeles
    const pxPts=ptsOrdered.map(p=>({
      px:cx+scale(p.x),
      py:cy+scale(p.y),
      orig:p
    }));

    // POLÍGONO DE CUERDAS — líneas entre puntos consecutivos (verde sólido)
    if(pxPts.length>=2){
      ctx.beginPath();
      ctx.moveTo(pxPts[0].px, pxPts[0].py);
      for(let i=1;i<pxPts.length;i++){
        ctx.lineTo(pxPts[i].px, pxPts[i].py);
      }
      ctx.closePath(); // cierra el polígono
      ctx.strokeStyle=col; ctx.lineWidth=2.0;
      ctx.shadowColor=col; ctx.shadowBlur=6;
      ctx.stroke();
      ctx.shadowBlur=0;
      // Relleno del polígono
      ctx.fillStyle=hexA(col,0.08); ctx.fill();
    }

    // PUNTOS individuales — círculos sólidos
    pxPts.forEach((pp,i)=>{
      const dist=Math.sqrt((pp.orig.x-fitCx)**2+(pp.orig.y-fitCy)**2);
      const dev=dist-fitR;
      // Color del punto según desviación
      const dotCol=Math.abs(dev)>fitR*0.004
        ?(dev>0?'#ff5252':'#5599ff')
        :'#22dd6a';

      // Línea residual (del borde del círculo Taubin al punto)
      const ang=Math.atan2(pp.orig.y-fitCy,pp.orig.x-fitCx);
      const cEdgePx=fCxPx+scaleAbs(fitR)*Math.cos(ang);
      const cEdgePy=fCyPx+scaleAbs(fitR)*Math.sin(ang);
      ctx.beginPath(); ctx.moveTo(cEdgePx,cEdgePy); ctx.lineTo(pp.px,pp.py);
      ctx.strokeStyle=hexA(dotCol,0.60); ctx.lineWidth=1.2; ctx.stroke();

      // Punto sólido con glow
      ctx.shadowColor=dotCol; ctx.shadowBlur=10;
      ctx.beginPath(); ctx.arc(pp.px,pp.py,5.5,0,Math.PI*2);
      ctx.fillStyle=dotCol; ctx.fill();
      ctx.strokeStyle='#08090f'; ctx.lineWidth=1.5; ctx.shadowBlur=0; ctx.stroke();

      // Número del punto
      const dist_px=Math.sqrt((pp.px-cx)**2+(pp.py-cy)**2);
      const la=Math.atan2(pp.py-cy,pp.px-cx);
      ctx.fillStyle='rgba(255,255,255,0.55)'; ctx.font='bold 9px DM Mono,monospace';
      ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.fillText(`${i+1}`, cx+(dist_px+16)*Math.cos(la), cy+(dist_px+16)*Math.sin(la));
    });
  }

  // ── CENTRO AJUSTADO (cian, cruz brillante) ──
  ctx.shadowColor='#00d4ff'; ctx.shadowBlur=10;
  ctx.strokeStyle='#00d4ff'; ctx.lineWidth=1.5;
  ctx.beginPath(); ctx.moveTo(fCxPx-10,fCyPx); ctx.lineTo(fCxPx+10,fCyPx); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(fCxPx,fCyPx-10); ctx.lineTo(fCxPx,fCyPx+10); ctx.stroke();
  ctx.beginPath(); ctx.arc(fCxPx,fCyPx,3,0,Math.PI*2);
  ctx.fillStyle='#00d4ff'; ctx.fill(); ctx.shadowBlur=0;

  // ── CENTRO NOMINAL (morado, pequeño) ──
  ctx.strokeStyle='rgba(150,120,255,0.7)'; ctx.lineWidth=1;
  ctx.beginPath(); ctx.moveTo(cx-6,cy); ctx.lineTo(cx+6,cy); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx,cy-6); ctx.lineTo(cx,cy+6); ctx.stroke();

  _drawInfoBox(ctx,W,H,mV,col,project,unit);
  _drawLegend(ctx,W,H);
}

function _drawInfoBox(ctx,W,H,m,col,project,unit){
  const ibX=7,ibY=H-92,ibW=190,ibH=86;
  ctx.fillStyle='rgba(8,9,15,0.88)'; ctx.fillRect(ibX,ibY,ibW,ibH);
  ctx.strokeStyle='rgba(255,255,255,0.10)'; ctx.lineWidth=0.5; ctx.strokeRect(ibX,ibY,ibW,ibH);
  ctx.font='10px DM Mono,monospace'; ctx.textAlign='left'; ctx.textBaseline='top';
  if(m&&m.fit){
    ctx.fillStyle=col||'#22dd6a';
    ctx.fillText(`Ovalidad: ${m.ovalityPct.toFixed(5)}%`,ibX+7,ibY+7);
    ctx.fillStyle='rgba(0,212,255,0.8)';
    ctx.fillText(`R: ${fromMM(m.r,unit).toFixed(4)} ${unit}`,ibX+7,ibY+21);
    ctx.fillText(`Ø: ${fromMM(m.r*2,unit).toFixed(4)} ${unit}`,ibX+7,ibY+35);
    ctx.fillStyle='rgba(200,220,255,0.5)';
    ctx.fillText(`Cx: ${fromMM(m.cx,unit).toFixed(4)}  Cy: ${fromMM(m.cy,unit).toFixed(4)}`,ibX+7,ibY+49);
    ctx.fillText(`RMSE: ${m.rmse.toFixed(4)} mm   n=${m.n}`,ibX+7,ibY+63);
  } else {
    ctx.fillStyle='rgba(255,255,255,0.25)';
    ctx.fillText('Sin datos suficientes',ibX+7,ibY+28);
    ctx.fillText('(mín. 3 puntos)',ibX+7,ibY+44);
  }
}

function _drawLegend(ctx,W,H){
  ctx.font='10px Barlow,sans-serif'; ctx.textAlign='left'; ctx.textBaseline='alphabetic';
  // Círculo cian = ajustado
  ctx.strokeStyle='#00d4ff'; ctx.lineWidth=2;
  ctx.beginPath(); ctx.moveTo(W-170,H-48); ctx.lineTo(W-148,H-48); ctx.stroke();
  ctx.fillStyle='rgba(255,255,255,0.65)'; ctx.fillText('Virola ajustada (Taubin)',W-144,H-44);
  // Morado = nominal
  ctx.strokeStyle='rgba(150,120,255,0.8)'; ctx.lineWidth=1.8; ctx.setLineDash([6,4]);
  ctx.beginPath(); ctx.moveTo(W-170,H-30); ctx.lineTo(W-148,H-30); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle='rgba(255,255,255,0.65)'; ctx.fillText('Diám. nominal',W-144,H-26);
  // Naranja = rodillos
  ctx.strokeStyle='rgba(255,154,48,0.8)'; ctx.lineWidth=1.8;
  ctx.beginPath(); ctx.moveTo(W-170,H-12); ctx.lineTo(W-148,H-12); ctx.stroke();
  ctx.fillStyle='rgba(255,255,255,0.65)'; ctx.fillText('Rodillos de apoyo',W-144,H-8);
}

// ─────────────────────────────────────────────────────────────────
//  11. GENERAR DEMO
// ─────────────────────────────────────────────────────────────────
function genDemoTire(diam_mm, ovalPct, rodDiam_mm=900) {
  const r=diam_mm/2, stretch=r*ovalPct/100/2;
  const n=6;
  const virola_pts=[];
  for(let i=0;i<n;i++){
    const a=(i/n)*2*Math.PI+(Math.random()-.5)*0.1;
    const rx=r+stretch*Math.cos(2*a)+(Math.random()-.5)*1.5;
    virola_pts.push({aV:90, aH:parseFloat(((a*180/Math.PI+360)%360).toFixed(3)), dist:parseFloat(rx.toFixed(3))});
  }
  const makeRodPts=rd=>{
    const rr=rd/2; const pts=[];
    for(let i=0;i<4;i++){
      const a=(i/4)*2*Math.PI;
      pts.push({aV:90, aH:parseFloat(((a*180/Math.PI+360)%360).toFixed(3)), dist:parseFloat((rr+(Math.random()-.5)*0.5).toFixed(3))});
    }
    return pts;
  };
  return {
    virola:{inputMode:'station',unit:'mm',nomDiam:diam_mm,points:virola_pts},
    rodIzq:{inputMode:'station',unit:'mm',nomDiam:rodDiam_mm,points:makeRodPts(rodDiam_mm)},
    rodDer:{inputMode:'station',unit:'mm',nomDiam:rodDiam_mm,points:makeRodPts(rodDiam_mm)}
  };
}

window.KS={
  toMM,fromMM,
  stationToCart,ptsToCartMM,
  taubinFit,kasaFit,
  calcMetrics,
  maxOvalityProject,projectStatusLevel,
  ovColor,hexA,
  drawKilnCylinder,drawSectionChart,
  genDemoTire
};
