import { useEffect, useRef } from 'react';
import Phaser from 'phaser';
import type { RestaurantSimulation } from '../simulation/core/engine';
import type { Point } from '../simulation/types';
import { RestaurantScene, type SceneBindings } from './scenes/RestaurantScene';

export interface GameCanvasProps {
  sim: RestaurantSimulation;
  selectedId?: string;
  onSelect: (id: string) => void;
  onCellClick: (point: Point) => void;
  debugPaths: boolean;
  debugUtilization: boolean;
  editing?: boolean;
}

/** Phaser owns presentation and the real-time clock, never restaurant rules. */
export function GameCanvas(props: GameCanvasProps) {
  const host = useRef<HTMLDivElement>(null);
  const bindings = useRef<SceneBindings>(props);
  bindings.current = props;

  useEffect(() => {
    if (!host.current) return;
    const scene = new RestaurantScene(() => bindings.current);
    const game = new Phaser.Game({
      // This procedural 2D scene uses Canvas for stable performance on software GPUs.
      type: Phaser.CANVAS,
      parent: host.current,
      backgroundColor: '#f5f3ec',
      antialias: true,
      scene: [scene],
      scale: {
        mode: Phaser.Scale.RESIZE,
        width: host.current.clientWidth,
        height: host.current.clientHeight,
      },
      render: { roundPixels: false },
      input: { mouse: { preventDefaultWheel: true } },
      banner: false,
      audio: { noAudio: true },
    });
    const resize = new ResizeObserver(() => {
      const element = host.current;
      if (element && element.clientWidth && element.clientHeight) {
        game.scale.resize(element.clientWidth, element.clientHeight);
      }
    });
    resize.observe(host.current);
    return () => {
      resize.disconnect();
      game.destroy(true);
    };
  }, []);

  return (
    <div
      className="game-canvas"
      ref={host}
      role="application"
      aria-label="Restaurant floor plan. Click a person or equipment to inspect. Use the mouse wheel to zoom and right-drag to pan."
    />
  );
}
