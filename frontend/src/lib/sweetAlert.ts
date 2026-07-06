import Swal, { type SweetAlertOptions } from "sweetalert2";
import "sweetalert2/dist/sweetalert2.min.css";

type TaradiSwalTone = "primary" | "danger";

const baseCustomClass = {
  popup: "taradi-swal-popup",
  title: "taradi-swal-title",
  htmlContainer: "taradi-swal-html",
  actions: "taradi-swal-actions",
  cancelButton: "taradi-swal-cancel",
  icon: "taradi-swal-icon"
};

export function showTaradiConfirm(options: SweetAlertOptions & { tone?: TaradiSwalTone }) {
  const { tone = "primary", customClass: _customClass, ...rest } = options;

  return Swal.fire({
    cancelButtonText: "إلغاء",
    showCancelButton: true,
    reverseButtons: true,
    buttonsStyling: false,
    focusCancel: true,
    heightAuto: false,
    ...rest,
    customClass: {
      ...baseCustomClass,
      confirmButton: tone === "danger"
        ? "taradi-swal-confirm taradi-swal-confirm-danger"
        : "taradi-swal-confirm"
    }
  });
}

export function showTaradiAlert(options: SweetAlertOptions & { tone?: TaradiSwalTone }) {
  const { tone = "primary", customClass: _customClass, ...rest } = options;

  return Swal.fire({
    confirmButtonText: "حسنًا",
    buttonsStyling: false,
    heightAuto: false,
    ...rest,
    customClass: {
      ...baseCustomClass,
      confirmButton: tone === "danger"
        ? "taradi-swal-confirm taradi-swal-confirm-danger"
        : "taradi-swal-confirm"
    }
  });
}
