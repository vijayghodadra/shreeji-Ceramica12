import { render, screen } from "@testing-library/react";
import App from "./App";
import { generateQuotationPDF } from "./pdf/quotationPdf";

jest.mock("axios", () => {
  const mockAxios = {
    get: jest.fn(),
    isCancel: jest.fn(() => false),
  };

  return {
    __esModule: true,
    default: mockAxios,
  };
});

test("renders the quotation workspace search input", () => {
  render(<App />);

  expect(
    screen.getByRole("heading", { name: /client information/i })
  ).toBeInTheDocument();

  expect(
    screen.getByPlaceholderText(/type code/i)
  ).toBeInTheDocument();

  expect(screen.getByRole("button", { name: /view pdf/i })).toBeInTheDocument();
});

test("generates a non-empty quotation pdf blob", async () => {
  const blob = await generateQuotationPDF(
    {
      clientInfo: {
        clientName: "Sample Client",
        mobile: "9999999999",
        company: "Sample Company",
        address: "Sample address",
        preparedBy: "Jagdish",
      },
      proposalNo: "PRO-TEST",
      date: "2026-04-20",
      products: [
        {
          name: "Wall Hung Basin",
          details: "Premium ceramic finish",
          sku: "SKU-101",
          size: "600 x 450 mm",
          qty: 2,
          rate: 12500,
          discount: 10,
          room: ["Kids Bathroom", "Master Bathroom"],
        },
      ],
    },
    { branding: true }
  );

  expect(blob).toBeInstanceOf(Blob);
  expect(blob.size).toBeGreaterThan(1000);
});
