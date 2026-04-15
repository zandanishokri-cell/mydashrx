'use client';
import { CheckCircle2, AlertTriangle, Clock, User, Image as ImageIcon } from 'lucide-react';

interface PodViewerProps {
  pod: {
    photoUrl?: string;
    photos?: Array<{ url: string; capturedAt?: string }>;
    signatureData?: string;
    recipientName?: string;
    idVerified?: boolean;
    isControlledSubstance?: boolean;
    idDobConfirmed?: boolean;
    deliveredAt?: string;
    capturedAt?: string;
    driverNote?: string;
    deliveryNotes?: string;
  };
}

export function PodViewer({ pod }: PodViewerProps) {
  const photoSrc = pod.photoUrl ?? pod.photos?.[pod.photos.length - 1]?.url;
  const deliveredAt = pod.deliveredAt ?? pod.capturedAt;

  return (
    <div className="space-y-4">
      {/* Meta row */}
      <div className="flex items-center gap-3 flex-wrap">
        {/* Timestamp */}
        {deliveredAt && (
          <span className="flex items-center gap-1.5 text-xs text-gray-500 bg-gray-100 px-2.5 py-1 rounded-full">
            <Clock size={11} />
            {new Date(deliveredAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
          </span>
        )}

        {/* Recipient */}
        {pod.recipientName && (
          <span className="flex items-center gap-1.5 text-xs text-gray-700 bg-gray-100 px-2.5 py-1 rounded-full">
            <User size={11} /> {pod.recipientName}
          </span>
        )}

        {/* Controlled substance */}
        {pod.isControlledSubstance && (
          <span className="flex items-center gap-1.5 text-xs bg-orange-100 text-orange-700 px-2.5 py-1 rounded-full font-medium">
            <AlertTriangle size={11} /> Controlled Substance
          </span>
        )}

        {/* ID verification badge */}
        {pod.isControlledSubstance ? (
          pod.idVerified ? (
            <span className="flex items-center gap-1.5 text-xs bg-green-100 text-green-700 px-2.5 py-1 rounded-full font-medium">
              <CheckCircle2 size={11} /> ID Verified
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-xs bg-red-100 text-red-600 px-2.5 py-1 rounded-full font-medium">
              <AlertTriangle size={11} /> ID Not Verified
            </span>
          )
        ) : (
          <span className="flex items-center gap-1.5 text-xs bg-gray-100 text-gray-500 px-2.5 py-1 rounded-full">
            No ID Required
          </span>
        )}
      </div>

      {/* Delivery photo */}
      {photoSrc && (
        <div>
          <p className="text-xs font-medium text-gray-500 mb-1.5 flex items-center gap-1.5">
            <ImageIcon size={12} /> Delivery Photo
          </p>
          <img
            src={photoSrc}
            alt="Delivery"
            className="w-full rounded-xl object-cover max-h-48 border border-gray-100"
          />
        </div>
      )}

      {/* Signature */}
      {pod.signatureData && (
        <div>
          <p className="text-xs font-medium text-gray-500 mb-1.5">Recipient Signature</p>
          <div className="border border-gray-200 rounded-xl overflow-hidden bg-gray-50 p-2">
            <img
              src={pod.signatureData}
              alt="Signature"
              className="w-full max-h-24 object-contain"
            />
          </div>
        </div>
      )}

      {/* Notes */}
      {(pod.driverNote || pod.deliveryNotes) && (
        <div className="bg-gray-50 rounded-xl px-3 py-2.5 text-sm text-gray-600">
          <span className="font-medium text-gray-700">Notes: </span>
          {pod.driverNote ?? pod.deliveryNotes}
        </div>
      )}

      {/* DOB confirmed detail for CS */}
      {pod.isControlledSubstance && pod.idVerified && pod.idDobConfirmed && (
        <div className="flex items-center gap-2 text-xs text-green-700 bg-green-50 rounded-xl px-3 py-2.5">
          <CheckCircle2 size={13} />
          DOB verified · MAPS confirmation received
        </div>
      )}
    </div>
  );
}
