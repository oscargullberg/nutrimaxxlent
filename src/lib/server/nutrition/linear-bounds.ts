export type LinearLimit = { coefficients: number[]; upper: number };

const epsilon = 1e-8;

// Two-phase simplex. Variables are nonnegative and limits have the form Ax <= b.
// Phase one finds a feasible starting point, including when b contains negative values.
export function maximize(limits: LinearLimit[], objective: number[]): number | null {
  const rows = limits.length;
  const columns = objective.length;
  const artificial = columns;
  const rhs = columns + 1;
  const phaseOne = rows + 1;
  const tableau = [
    ...limits.map(({ coefficients, upper }) => [...coefficients, -1, upper]),
    [...objective.map((coefficient) => -coefficient), 0, 0],
    [...objective.map(() => 0), 1, 0]
  ];
  const basic = limits.map((_, row) => columns + row);
  const free = [...objective.map((_, index) => index), -1];

  function pivot(row: number, column: number) {
    const active = tableau[row]!;
    const divisor = active[column]!;
    for (const [index, other] of tableau.entries()) {
      if (index === row) continue;
      const factor = other[column]! / divisor;
      for (let j = 0; j <= rhs; j++) {
        if (j !== column) other[j] = other[j]! - factor * active[j]!;
      }
      other[column] = -factor;
    }
    for (let j = 0; j <= rhs; j++) {
      if (j !== column) active[j] = active[j]! / divisor;
    }
    active[column] = 1 / divisor;
    [basic[row], free[column]] = [free[column]!, basic[row]!];
  }

  function optimize(target: number) {
    const costs = tableau[target]!;
    for (let step = 0; step < 2000; step++) {
      let entering = -1;
      for (let column = 0; column <= columns; column++) {
        if (target !== phaseOne && free[column] === -1) continue;
        if (costs[column]! < -epsilon && (entering === -1 || free[column]! < free[entering]!)) {
          entering = column;
        }
      }
      if (entering === -1) return true;

      let leaving = -1;
      let bestRatio = Infinity;
      for (let row = 0; row < rows; row++) {
        const values = tableau[row]!;
        if (values[entering]! <= epsilon) continue;
        const ratio = values[rhs]! / values[entering]!;
        if (
          ratio < bestRatio - epsilon ||
          (Math.abs(ratio - bestRatio) <= epsilon && basic[row]! < basic[leaving]!)
        ) {
          leaving = row;
          bestRatio = ratio;
        }
      }
      if (leaving === -1) return false;
      pivot(leaving, entering);
    }
    return false;
  }

  let initial = 0;
  for (let row = 1; row < rows; row++) {
    if (tableau[row]![rhs]! < tableau[initial]![rhs]!) initial = row;
  }
  if (tableau[initial]![rhs]! < -epsilon) {
    pivot(initial, artificial);
    if (!optimize(phaseOne) || Math.abs(tableau[phaseOne]![rhs]!) > epsilon) return null;
    const artificialRow = basic.indexOf(-1);
    if (artificialRow !== -1) {
      const column = tableau[artificialRow]!.findIndex(
        (coefficient, index) => index < rhs && Math.abs(coefficient) > epsilon
      );
      if (column !== -1) pivot(artificialRow, column);
    }
  }
  return optimize(rows) ? tableau[rows]![rhs]! : null;
}
