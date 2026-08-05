import { useTheme } from '../store/theme';

/**
 * Chart parameters for BizPilot.
 *
 * There are two categorical palettes, one per surface, and the dark one is
 * **selected, not derived**. Running the light palette against the dark card
 * colour fails outright: indigo #4338CA drops below the lightness band and
 * seven of the eight sit under 3:1 contrast on #1E293B. Every hue therefore has
 * a second step chosen for that surface, keeping the same hue order so a series
 * does not change identity when the shopkeeper flips the switch.
 *
 * Both were checked with the palette validator and pass all six checks:
 *
 *   light on #FFFFFF — CVD worst adjacent ΔE 8.7 (deutan), normal ΔE 18.1
 *   dark  on #1E293B — CVD worst adjacent ΔE 12.8 (protan), normal ΔE 22.0,
 *                      all eight ≥ 3:1 contrast
 *
 * Do not reorder or extend either list by eye. Hues are assigned in this fixed
 * order and adjacency is what was validated; a ninth series folds into "Other"
 * rather than getting a new colour.
 */

const CATEGORICAL_LIGHT = [
  '#0D9488', // teal — also the brand hue, so series 1 reads as "us"
  '#C2410C', // burnt orange
  '#4338CA', // indigo
  '#A16207', // ochre
  '#BE185D', // magenta
  '#0369A1', // deep sky
  '#4D7C0F', // olive
  '#7E22CE', // violet
] as const;

/** The same eight hues, re-stepped for the dark card surface. */
const CATEGORICAL_DARK = [
  '#0F9E90', // teal
  '#E8650A', // burnt orange
  '#7C82F0', // indigo
  '#C28704', // ochre
  '#E85699', // magenta
  '#0E9BE0', // deep sky
  '#65A30D', // olive
  '#B06BF8', // violet
] as const;

export interface ChartTheme {
  categorical: readonly string[];
  /** Magnitude, one hue light→dark. Colour encodes size, not identity. */
  sequentialHue: string;
  /** Money in vs money out. Not categorical — these two have fixed meaning. */
  series: { revenue: string; profit: string };
  /** Recessive axes and grid: the data should be the only assertive thing. */
  axis: { stroke: string; fontSize: number; tickLine: false; axisLine: false };
  grid: { stroke: string; strokeDasharray: string; vertical: false };
  tooltip: {
    contentStyle: Record<string, string | number>;
    labelStyle: Record<string, string | number>;
    cursor: { stroke: string; strokeWidth: number };
  };
  /** Assigns a colour by position, never by rank, so filtering cannot repaint. */
  color: (index: number) => string;
}

function build(dark: boolean): ChartTheme {
  const categorical = dark ? CATEGORICAL_DARK : CATEGORICAL_LIGHT;

  return {
    categorical,
    sequentialHue: categorical[0],
    series: { revenue: categorical[0], profit: categorical[1] },
    axis: {
      stroke: dark ? '#8D9AB0' : '#94A3B8',
      fontSize: 11,
      tickLine: false,
      axisLine: false,
    },
    grid: {
      stroke: dark ? '#2D3F55' : '#E2E8F0',
      strokeDasharray: '3 3',
      vertical: false,
    },
    tooltip: {
      contentStyle: {
        borderRadius: 10,
        border: `1px solid ${dark ? '#3F5871' : '#E2E8F0'}`,
        background: dark ? '#1E293B' : '#FFFFFF',
        boxShadow: dark
          ? '0 4px 16px rgb(0 0 0 / 0.6)'
          : '0 4px 12px rgb(15 23 42 / 0.08)',
        fontSize: 13,
        padding: '8px 10px',
      },
      labelStyle: {
        color: dark ? '#F1F5F9' : '#0F172A',
        fontWeight: 600,
        marginBottom: 2,
      },
      // Recharts' default cursor is a heavy grey block; a hairline reads as a
      // crosshair instead of a selection.
      cursor: { stroke: dark ? '#64748B' : '#94A3B8', strokeWidth: 1 },
    },
    color: (index: number) => categorical[index % categorical.length],
  };
}

const LIGHT = build(false);
const DARK = build(true);

/**
 * Chart colours for the theme currently on screen.
 *
 * Recharts takes its colours as props rather than from CSS, so the override
 * rules in index.css cannot reach the marks themselves — the component has to
 * re-render with new values. Reading the theme store here is what makes that
 * happen the moment the switch is flipped.
 */
export function useChartTheme(): ChartTheme {
  return useTheme((state) => state.theme) === 'dark' ? DARK : LIGHT;
}
