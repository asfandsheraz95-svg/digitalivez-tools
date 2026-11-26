'use client'

import { useMemo, useState } from 'react'
import { ArrowUpRight, ChartNoAxesCombined, Wallet } from 'lucide-react'

export function HomeMarginCalculator() {
  const [cost, setCost] = useState('60')
  const [price, setPrice] = useState('100')
  const result = useMemo(() => {
    const costValue = Number(cost)
    const priceValue = Number(price)
    if (!cost.trim() || !price.trim() || !Number.isFinite(costValue) || !Number.isFinite(priceValue) || costValue < 0 || priceValue <= 0) return null
    return { margin: ((priceValue - costValue) / priceValue) * 100, profit: priceValue - costValue, cost: costValue, price: priceValue }
  }, [cost, price])
  const money = (value: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value)

  return <div className="hero-visual"><div className="hero-card-top"><div><span className="eyebrow">QUICK CALCULATOR</span><h2>Know your numbers.</h2></div><span className="hero-spark"><ChartNoAxesCombined size={20}/></span></div>
    <div className="metric-card"><span>Gross profit margin</span><strong>{result ? result.margin.toFixed(2).replace(/\.00$/, '') : '—'}<span>{result ? '%' : ''}</span></strong><div className="metric-track"><i style={{ width: `${result ? Math.min(100, Math.max(0, result.margin)) : 0}%` }}/></div><small>Profit divided by selling price</small></div>
    <div className="mini-cards"><label><span className="mini-icon green"><Wallet size={17}/></span><small>Product cost</small><span className="hero-input-wrap"><span>$</span><input aria-label="Product cost" type="number" min="0" step="any" value={cost} onChange={event => setCost(event.target.value)}/></span></label><label><span className="mini-icon blue"><ArrowUpRight size={17}/></span><small>Selling price</small><span className="hero-input-wrap"><span>$</span><input aria-label="Selling price" type="number" min="0.01" step="any" value={price} onChange={event => setPrice(event.target.value)}/></span></label></div>
    <div className="calculated-note" aria-live="polite"><span className="status-dot"/> {result ? `${money(result.price)} − ${money(result.cost)} = ${money(result.profit)} profit` : 'Enter a non-negative cost and a selling price above zero'}</div>
  </div>
}
