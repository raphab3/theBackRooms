// Canvas, dimensões da tela e atalho $ para getElementById.
const canvas = document.getElementById('view'),
  ctx = canvas.getContext('2d', { alpha: false }),
  $ = id => document.getElementById(id),
  W = matchMedia('(pointer:coarse)').matches ? 400 : 600,
  H = W * 0.6,
  N = 21;
canvas.width = W;
canvas.height = H;

export { $, H, N, W, canvas, ctx };
