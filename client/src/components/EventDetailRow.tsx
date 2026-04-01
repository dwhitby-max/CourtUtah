import { CourtEvent } from "@shared/types";

interface Props {
  event: CourtEvent;
}

export default function EventDetailRow({ event }: Props) {
  return (
    <td colSpan={7} className="px-6 py-3">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
        {event.prosecutingAttorney && (
          <div>
            <span className="text-gray-500 text-xs block">Prosecuting Attorney</span>
            <span className="font-medium">{event.prosecutingAttorney}</span>
          </div>
        )}
        {event.defenseAttorney && (
          <div>
            <span className="text-gray-500 text-xs block">Defense Attorney</span>
            <span className="font-medium">{event.defenseAttorney}</span>
          </div>
        )}
        {event.defendantOtn && (
          <div>
            <span className="text-gray-500 text-xs block">OTN</span>
            <span className="font-medium">{event.defendantOtn}</span>
          </div>
        )}
        {event.defendantDob && (
          <div>
            <span className="text-gray-500 text-xs block">DOB</span>
            <span className="font-medium">{event.defendantDob}</span>
          </div>
        )}
        {event.citationNumber && (
          <div>
            <span className="text-gray-500 text-xs block">Citation #</span>
            <span className="font-medium">{event.citationNumber}</span>
          </div>
        )}
        {event.sheriffNumber && (
          <div>
            <span className="text-gray-500 text-xs block">Sheriff #</span>
            <span className="font-medium">{event.sheriffNumber}</span>
          </div>
        )}
        {event.leaNumber && (
          <div>
            <span className="text-gray-500 text-xs block">LEA #</span>
            <span className="font-medium">{event.leaNumber}</span>
          </div>
        )}
        {event.charges && event.charges.length > 0 && (
          <div className="col-span-2 md:col-span-3">
            <span className="text-gray-500 text-xs block">Charges</span>
            <ul className="list-disc list-inside text-sm space-y-0.5 mt-0.5">
              {event.charges.map((charge, i) => (
                <li key={i} className="text-gray-800">{charge}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </td>
  );
}
