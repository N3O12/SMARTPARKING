import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizarPlaca,
  calcularAutosEnTransito,
  calcularCajonesLibres,
  puedeIngresar,
  validarSalidaCruzada,
  CAPACIDAD_MAXIMA
} from './parkingRules';

test('normalizarPlaca cleans spaces and formats standard 6-7 char plates', () => {
  assert.equal(normalizarPlaca('w1x 942'), 'W1X-942');
  assert.equal(normalizarPlaca('abc-123'), 'ABC-123');
  assert.equal(normalizarPlaca('  xyz8899 '), 'XYZ-8899');
});

test('calcularAutosEnTransito returns difference between recinto and ocupados', () => {
  assert.equal(calcularAutosEnTransito(5, 3), 2);
  assert.equal(calcularAutosEnTransito(2, 2), 0);
  assert.equal(calcularAutosEnTransito(1, 4), 0); // never negative
});

test('calcularCajonesLibres calculates free spots out of 8', () => {
  assert.equal(calcularCajonesLibres(3), 5);
  assert.equal(calcularCajonesLibres(8), 0);
});

test('puedeIngresar respects capacity limit of 8 and prevents duplicate inside plates', () => {
  const inside = [
    {
      id_ticket: 'TKT-1001',
      placa: 'W1X-942',
      hora_entrada: new Date().toISOString(),
      hora_salida: null,
      tiempo_estadia_minutos: null,
      estado: 'DENTRO' as const
    }
  ];

  // At capacity
  const capCheck = puedeIngresar(CAPACIDAD_MAXIMA, 'ABC-123', inside);
  assert.equal(capCheck.permitido, false);

  // Duplicate plate already inside
  const dupCheck = puedeIngresar(1, 'w1x-942', inside);
  assert.equal(dupCheck.permitido, false);

  // Normal entrance allowed
  const okCheck = puedeIngresar(1, 'DEF-456', inside);
  assert.equal(okCheck.permitido, true);
});

test('validarSalidaCruzada detects mismatch between QR plate and Exit Camera plate', () => {
  // Fraud mismatch
  const fraudResult = validarSalidaCruzada('W1X-942', 'ABC-999');
  assert.equal(fraudResult.valido, false);
  assert.equal(fraudResult.alertaFraude, true);
  assert.match(fraudResult.mensaje, /ALERTA DE SEGURIDAD/);

  // Match success
  const matchResult = validarSalidaCruzada('w1x-942', 'W1X 942');
  assert.equal(matchResult.valido, true);
  assert.equal(matchResult.alertaFraude, false);
});
