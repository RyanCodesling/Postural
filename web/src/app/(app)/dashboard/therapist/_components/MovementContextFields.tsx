"use client";

import type {
  LoadUnit,
  PrescribedSide,
  ResistanceType,
} from "@/lib/prescriptionContext";

export type MovementContextForm = {
  prescribedSide?: PrescribedSide;
  resistanceType?: Exclude<ResistanceType, "unknown">;
  resistanceValue?: number;
  resistanceUnit?: LoadUnit;
  resistanceLabel?: string;
};

export default function MovementContextFields({
  value,
  disabled = false,
  onChange,
}: {
  value: MovementContextForm;
  disabled?: boolean;
  onChange: (patch: Partial<MovementContextForm>) => void;
}) {
  const resistanceType = value.resistanceType ?? "none";
  const inputClass = `w-full border rounded-lg px-2 py-1.5 text-sm ${
    disabled
      ? "border-gray-200 bg-gray-100 text-gray-400 cursor-not-allowed"
      : "border-gray-300"
  }`;

  const changeResistanceType = (
    next: Exclude<ResistanceType, "unknown">,
  ) => {
    onChange({
      resistanceType: next,
      resistanceValue: undefined,
      resistanceUnit: undefined,
      resistanceLabel: undefined,
    });
  };

  return (
    <fieldset className="rounded-lg border border-gray-200 p-3">
      <legend className="px-1 text-xs font-semibold text-gray-600">
        Movement context
      </legend>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-gray-500 mb-1">
            Prescribed side
          </label>
          <select
            value={value.prescribedSide ?? "both"}
            disabled={disabled}
            onChange={(event) =>
              onChange({
                prescribedSide: event.target.value as PrescribedSide,
              })
            }
            className={inputClass}
          >
            <option value="both">Both sides</option>
            <option value="left">Left only</option>
            <option value="right">Right only</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">
            Resistance
          </label>
          <select
            value={resistanceType}
            disabled={disabled}
            onChange={(event) =>
              changeResistanceType(
                event.target.value as Exclude<ResistanceType, "unknown">,
              )
            }
            className={inputClass}
          >
            <option value="none">None</option>
            <option value="external_weight">External weight</option>
            <option value="resistance_band">Resistance band</option>
            <option value="other">Other</option>
          </select>
        </div>
      </div>

      {(resistanceType === "resistance_band" ||
        resistanceType === "other") && (
        <div className="mt-3">
          <label className="block text-xs text-gray-500 mb-1">
            {resistanceType === "resistance_band"
              ? "Band label"
              : "Resistance label"}{" "}
            <span className="text-red-500">*</span>
          </label>
          <input
            value={value.resistanceLabel ?? ""}
            maxLength={80}
            disabled={disabled}
            onChange={(event) =>
              onChange({ resistanceLabel: event.target.value })
            }
            placeholder={
              resistanceType === "resistance_band"
                ? "e.g. light red band"
                : "e.g. water bottle"
            }
            className={inputClass}
          />
        </div>
      )}

      {resistanceType !== "none" && (
        <div className="grid grid-cols-2 gap-3 mt-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">
              Load{" "}
              {resistanceType === "external_weight" ? (
                <span className="text-red-500">*</span>
              ) : (
                "(optional)"
              )}
            </label>
            <input
              type="number"
              min="0.001"
              step="0.1"
              value={value.resistanceValue ?? ""}
              disabled={disabled}
              onChange={(event) =>
                onChange({
                  resistanceValue: event.target.value
                    ? Number(event.target.value)
                    : undefined,
                })
              }
              className={inputClass}
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Unit</label>
            <select
              value={value.resistanceUnit ?? ""}
              disabled={disabled}
              onChange={(event) =>
                onChange({
                  resistanceUnit:
                    event.target.value === "kg" ||
                    event.target.value === "lb"
                      ? event.target.value
                      : undefined,
                })
              }
              className={inputClass}
            >
              <option value="">Select</option>
              <option value="kg">kg</option>
              <option value="lb">lb</option>
            </select>
          </div>
        </div>
      )}
    </fieldset>
  );
}
