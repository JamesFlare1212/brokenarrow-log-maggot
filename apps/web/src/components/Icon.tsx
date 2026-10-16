import { FontAwesomeIcon, type FontAwesomeIconProps } from '@fortawesome/react-fontawesome';

type IconProps = Omit<FontAwesomeIconProps, 'size'> & { size?: number };

export function Icon({ size = 16, style, ...props }: IconProps) {
  return (
    <FontAwesomeIcon
      aria-hidden="true"
      {...props}
      style={{ fontSize: size, '--fa-width': '1em', ...style }}
    />
  );
}
