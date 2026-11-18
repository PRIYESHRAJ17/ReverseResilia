/**
 * MagnificationDock Component
 * 
 * A premium macOS-inspired dock component with fluid magnification effects, 
 * spring physics, and tooltips. Built with Framer Motion.
 */

import {
  motion,
  MotionValue,
  useMotionValue,
  useSpring,
  useTransform,
  type SpringOptions,
  AnimatePresence
} from 'framer-motion';
import React, { Children, cloneElement, useEffect, useMemo, useRef, useState } from 'react';

export type DockItemData = {
  icon: React.ReactNode;
  label: React.ReactNode;
  onClick?: () => void;
  href?: string;
  className?: string;
  isActive?: boolean;
};

export type DockProps = {
  items: DockItemData[];
  className?: string;
  distance?: number;
  panelHeight?: number;
  baseItemSize?: number;
  dockHeight?: number;
  magnification?: number;
  spring?: SpringOptions;
  tooltipPlacement?: 'top' | 'bottom';
};

type DockItemProps = {
  className?: string;
  children: React.ReactNode;
  onClick?: () => void;
  href?: string;
  mouseX: MotionValue<number>;
  spring: SpringOptions;
  distance: number;
  baseItemSize: number;
  magnification: number;
  isActive?: boolean;
};

function DockItem({
  children,
  className = '',
  onClick,
  href,
  mouseX,
  spring,
  distance,
  magnification,
  baseItemSize,
  isActive = false
}: DockItemProps) {
  const ref = useRef<any>(null);
  const isHovered = useMotionValue(0);

  const mouseDistance = useTransform(mouseX, (val) => {
    const rect = ref.current?.getBoundingClientRect() ?? {
      x: 0,
      width: baseItemSize
    };
    return val - rect.x - baseItemSize / 2;
  });

  const targetSize = useTransform(mouseDistance, [-distance, 0, distance], [baseItemSize, magnification, baseItemSize]);
  const size = useSpring(targetSize, spring);

  const handleClick = (e: React.MouseEvent) => {
    if (onClick) {
      onClick();
    } else if (href) {
      window.location.href = href;
    }
  };

  const Component = href ? motion.a : motion.div;

  return (
    <Component
      ref={ref}
      href={href}
      style={{
        width: size,
        height: size
      }}
      onHoverStart={() => isHovered.set(1)}
      onHoverEnd={() => isHovered.set(0)}
      onFocus={() => isHovered.set(1)}
      onBlur={() => isHovered.set(0)}
      onClick={handleClick}
      className={`dock-item ${isActive ? 'is-active' : ''} ${className}`}
      tabIndex={0}
      role={href ? 'link' : 'button'}
    >
      {Children.map(children, (child) =>
        React.isValidElement(child)
          ? cloneElement(child as React.ReactElement<{ isHovered?: MotionValue<number> }>, { isHovered })
          : child
      )}
      {isActive && <span className="dock-active-dot" aria-hidden="true" />}
    </Component>
  );
}

type DockLabelProps = {
  className?: string;
  children: React.ReactNode;
  isHovered?: MotionValue<number>;
  placement?: 'top' | 'bottom';
};

function DockLabel({ children, className = '', isHovered, placement = 'bottom' }: DockLabelProps) {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (!isHovered) return;
    const unsubscribe = isHovered.on('change', (latest) => {
      setIsVisible(latest === 1);
    });
    return () => unsubscribe();
  }, [isHovered]);

  const isBottom = placement === 'bottom';

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ opacity: 0, y: isBottom ? -4 : 4 }}
          animate={{ opacity: 1, y: isBottom ? 8 : -8 }}
          exit={{ opacity: 0, y: isBottom ? -4 : 4 }}
          transition={{ duration: 0.18, ease: 'easeOut' }}
          className={`dock-tooltip ${isBottom ? 'dock-tooltip--bottom' : 'dock-tooltip--top'} ${className}`}
          role="tooltip"
          style={{ x: '-50%' }}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

type DockIconProps = {
  className?: string;
  children: React.ReactNode;
  isHovered?: MotionValue<number>;
};

function DockIcon({ children, className = '' }: DockIconProps) {
  return <div className={`dock-icon ${className}`}>{children}</div>;
}

export function MagnificationDock({
  items,
  className = '',
  spring = { mass: 0.1, stiffness: 150, damping: 12 },
  magnification = 52,
  distance = 160,
  panelHeight = 44,
  dockHeight = 64,
  baseItemSize = 36,
  tooltipPlacement = 'bottom'
}: DockProps) {
  const mouseX = useMotionValue(Infinity);
  const isHovered = useMotionValue(0);

  const maxHeight = useMemo(() => Math.max(dockHeight, magnification + 12), [dockHeight, magnification]);
  const heightRow = useTransform(isHovered, [0, 1], [panelHeight, maxHeight]);
  const height = useSpring(heightRow, spring);

  return (
    <motion.div style={{ height, scrollbarWidth: 'none' }} className="dock-wrapper">
      <motion.div
        onMouseMove={({ pageX }) => {
          isHovered.set(1);
          mouseX.set(pageX);
        }}
        onMouseLeave={() => {
          isHovered.set(0);
          mouseX.set(Infinity);
        }}
        className={`dock-panel ${className}`}
        style={{ height: panelHeight }}
        role="toolbar"
        aria-label="Application dock"
      >
        {items.map((item, index) => (
          <DockItem
            key={index}
            onClick={item.onClick}
            href={item.href}
            className={item.className}
            isActive={item.isActive}
            mouseX={mouseX}
            spring={spring}
            distance={distance}
            magnification={magnification}
            baseItemSize={baseItemSize}
          >
            <DockIcon>{item.icon}</DockIcon>
            <DockLabel placement={tooltipPlacement}>{item.label}</DockLabel>
          </DockItem>
        ))}
      </motion.div>
    </motion.div>
  );
}

export default MagnificationDock;
