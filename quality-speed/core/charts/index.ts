// SPDX-License-Identifier: Apache-2.0
// The chart kit. Every function is pure and returns a string of HTML and inline SVG, complete before any script
// runs. Link `charts.css` and `charts.js` from the page. README.md has a short example per component.

export { ring } from './ring.ts';
export type { RingProps, RingScore, RingSize } from './ring.ts';
export { bullet, bullets, bulletPosition, GOAL_AT } from './bullet.ts';
export type { BulletProps } from './bullet.ts';
export { trend, sparkline } from './trend.ts';
export type { TrendPoint, TrendProps } from './trend.ts';
export { heatmap, heatLegend } from './heatmap.ts';
export type { HeatAxisItem, HeatCell, HeatmapProps } from './heatmap.ts';
export { dataTable } from './table.ts';
export type { Cell, Column, DataTableProps } from './table.ts';
export { roadTo100 } from './road.ts';
export type { RoadFixProps, RoadProps, RoadScore } from './road.ts';
export { historyRows, timeline } from './timeline.ts';
export type { HistoryLineLike, TimelineProps, TimelineRow, TimelineScore } from './timeline.ts';
export { filmstrip } from './filmstrip.ts';
export type { FilmFrame, FilmstripProps, FrameState } from './filmstrip.ts';
export { statTile, missingTile, tileRow } from './tiles.ts';
export type { StatTileProps } from './tiles.ts';
export { pictogram, dotMatrix, meter, dayStrip, markKey } from './blocks.ts';
export type { DayState, DotMatrixProps, MeterProps, PassState, PictogramProps } from './blocks.ts';
export { metricBullet, metricTile } from './metric.ts';
export type { MetricLike, ReadingLike } from './metric.ts';
export { ringGrid } from './grid.ts';
export type { RingGroup } from './grid.ts';
export { sketch } from './sketch.ts';
export type { SketchKind } from './sketch.ts';
export { esc, fmtDate, fmtValue, icon, scoreBand, tableView } from './svg.ts';
export type { Lens, Stage, Status } from './svg.ts';
export { totalOf } from './charts.js';
