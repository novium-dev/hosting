import { Link as RouterLink, type LinkProps } from "react-router-dom";

type Props = Omit<LinkProps, "to"> & {
  href?: LinkProps["to"];
  to?: LinkProps["to"];
};

export default function Link({ href, to, ...props }: Props) {
  return <RouterLink to={to ?? href ?? "#"} {...props} />;
}
