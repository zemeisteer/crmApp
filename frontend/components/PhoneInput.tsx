"use client";

import { formatUzPhone } from "@/lib/validation";

type Props = Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type"> & {
  value: string;
  onChange: (value: string) => void;
};

// Phone field with "+998" filled in and the number grouped while typing.
// An untouched optional field stays empty; it shows "+998 " once focused.
export default function PhoneInput({ value, onChange, onFocus, onBlur, placeholder = "+998 90 123 45 67", ...rest }: Props) {
  return (
    <input
      {...rest}
      type="tel"
      inputMode="tel"
      autoComplete={rest.autoComplete ?? "tel"}
      placeholder={placeholder}
      maxLength={17}
      value={value}
      onChange={(e) => onChange(formatUzPhone(e.target.value))}
      onFocus={(e) => {
        if (!value) onChange("+998 ");
        onFocus?.(e);
      }}
      onBlur={(e) => {
        if (value.replace(/\D/g, "").length <= 3) onChange("");
        onBlur?.(e);
      }}
    />
  );
}
