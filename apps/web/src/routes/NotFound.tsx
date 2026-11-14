import { Compass } from "lucide-react";
import { Link } from "react-router-dom";
import { Gate, GateCard } from "./Gate";

export function NotFound({ space = false }: { space?: boolean }) {
  return (
    <Gate>
      <GateCard
        icon={<Compass size={22} aria-hidden="true" />}
        title={space ? "This space does not exist" : "Nothing here"}
        text={
          space
            ? "The link may be incomplete, or the space was removed from this server. Ask whoever invited you to send the link again."
            : "That address does not lead anywhere."
        }
      >
        <Link className="btn btn-primary" to="/">
          Create a new space
        </Link>
      </GateCard>
    </Gate>
  );
}
