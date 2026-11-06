import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizarPlaca,
  buscarSecuenciasPlacaEnTexto,
  calcularAutosEnTransito,
  calcularCajonesLibres,
  puedeIngresar,
  validarSalidaCruzada,
  CAPACIDAD_MAXIMA
} from './parkingRules';

test('normalizarPlaca cleans spaces and formats standard 6 char plates and handwritten plates', () => {
  assert.equal(normalizarPlaca('x71 962'), 'X71-962');
  assert.equal(normalizarPlaca('abc-123'), 'ABC-123');
  assert.equal(normalizarPlaca('abc f12'), 'ABC-F12');
  assert.equal(normalizarPlaca('20C-37F'), '206-37F');
  assert.equal(normalizarPlaca('W2U-792'), 'W2U-792');
});

test('normalizarPlaca and buscarSecuenciasPlacaEnTexto reject empty-scene noise and cross-line specks', () => {
  // Scattered characters across newlines must never join into a fake plate
  const scatteredNoise = '48\n\n-\n\nI 1\n\nBA\n\nI\n\n1\n\nA';
  assert.equal(buscarSecuenciasPlacaEnTexto(scatteredNoise).length, 0);
  assert.equal(normalizarPlaca(scatteredNoise), '');

  // Vertical bars / notebook lines / pure digits / pure letters must be rejected
  assert.equal(normalizarPlaca('I11-111'), '');
  assert.equal(normalizarPlaca('11B-111'), '');
  assert.equal(normalizarPlaca('123-456'), '');
  assert.equal(normalizarPlaca('ABC-DEF'), '');
  assert.equal(normalizarPlaca('AAA-A12'), '');
  assert.equal(normalizarPlaca('Buscando placa válida en el vehículo...'), '');
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
