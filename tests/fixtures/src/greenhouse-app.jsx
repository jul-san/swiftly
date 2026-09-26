// Greenhouse job-boards fixture, rendered with real React 18 + React Select 5
// so the tests exercise the same controlled-input and combobox behavior as
// job-boards.greenhouse.io. Markup (ids, label wiring, class names,
// classNamePrefix "select", education--container, fieldset.checkbox,
// phone-input) mirrors a saved live application; question wording comes from
// real Greenhouse postings (via the public boards API). No employer content.

import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import Select from "react-select";
import AsyncSelect from "react-select/async";

const state = {};
window.__ghState = () => JSON.parse(JSON.stringify(state));

const opts = (labels) => labels.map((l, i) => ({ value: String(i + 1), label: l }));

function Label({ id, text, required }) {
  return (
    <label id={`${id}-label`} htmlFor={id} className={id.includes("--") || id.startsWith("question") || id === "country" || id === "gender" ? "label select__label" : "label"}>
      {text}{required ? <span aria-hidden="true">*</span> : null}
    </label>
  );
}

function TextField({ id, label, required, type = "text", autoComplete, initial = "" }) {
  const [v, setV] = useState(initial);
  state[id] = v;
  return (
    <div className="text-input-wrapper"><div className="input-wrapper">
      <Label id={id} text={label} required={required} />
      <input id={id} className="input input__single-line" aria-label={label} aria-required={required ? "true" : "false"}
        type={type} autoComplete={autoComplete} value={v} onChange={e => setV(e.target.value)} />
    </div></div>
  );
}

function TextArea({ id, label, required }) {
  const [v, setV] = useState("");
  state[id] = v;
  return (
    <div className="text-input-wrapper"><div className="input-wrapper">
      <Label id={id} text={label} required={required} />
      <textarea id={id} className="input input__multi-line" aria-required={required ? "true" : "false"} value={v} onChange={e => setV(e.target.value)} />
    </div></div>
  );
}

function SelectField({ id, label, required, options, onPick, async: isAsync }) {
  const [v, setV] = useState(null);
  state[id] = v?.label ?? null;
  const common = {
    inputId: id,
    "aria-labelledby": `${id}-label`,
    "aria-required": required,
    classNamePrefix: "select",
    className: "select-shell",
    value: v,
    onChange: (o) => { setV(o); onPick?.(o); },
    placeholder: "Select...",
  };
  const loadOptions = (q) => new Promise(r => setTimeout(() => r(options.filter(o => o.label.toLowerCase().includes(q.toLowerCase()))), 120));
  return (
    <div className="select"><div className="select__container">
      <Label id={id} text={label} required={required} />
      {isAsync ? <AsyncSelect {...common} loadOptions={loadOptions} cacheOptions={false} defaultOptions={false} /> : <Select {...common} options={options} />}
      {required ? <input required tabIndex={-1} aria-hidden="true" className="remix-css-requiredInput" value={v?.value ?? ""} onChange={() => {}} /> : null}
    </div></div>
  );
}

function CheckboxGroup({ id, legend, options, required }) {
  const [checked, setChecked] = useState([]);
  state[id] = checked;
  return (
    <fieldset className="checkbox" id={id} aria-required={required ? "true" : "false"}>
      <legend className="label checkbox__description">{legend} {required ? <span className="required">*</span> : null}</legend>
      {options.map((o, i) => (
        <div className="checkbox__wrapper" key={o}>
          <div className="checkbox__input">
            <input type="checkbox" id={`${id}_${i}`} name={id} value={String(i)} checked={checked.includes(o)}
              onChange={e => setChecked(c => e.target.checked ? [...c, o] : c.filter(x => x !== o))} />
          </div>
          <label htmlFor={`${id}_${i}`}>{o}</label>
        </div>
      ))}
    </fieldset>
  );
}

function FileField({ id, label, required }) {
  const [name, setName] = useState(null);
  state[id] = name;
  return (
    <div className="file-upload" role="group" aria-labelledby={`upload-label-${id}`} aria-required={required ? "true" : "false"}>
      <div className="label upload-label" id={`upload-label-${id}`}>{label}{required ? <span aria-hidden="true">*</span> : null}</div>
      <div className="button-container"><div className="secondary-button"><div>
        <button type="button" className="btn btn--rounded">Attach</button>
        <label className="visually-hidden" htmlFor={id}>Attach</label>
        <input id={id} className="visually-hidden" type="file" accept=".pdf,.doc,.docx,.txt,.rtf"
          onChange={e => setName(e.target.files?.[0]?.name ?? null)} />
      </div></div>
        <div className="secondary-button"><button type="button" className="btn btn--rounded">Enter manually</button></div>
      </div>
      {name ? <div className="file-upload__filename">{name}</div> : null}
    </div>
  );
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const SCHOOLS = ["Example State University", "Example Institute of Technology", "University of Example", "Example Community College", ...Array.from({ length: 60 }, (_, i) => `Sample College ${i + 1}`)];

function App() {
  const [sponsorAnswered, setSponsorAnswered] = useState(false);
  const [submitted, setSubmitted] = useState(0);
  window.__ghSubmitCount = () => submitted;
  return (
    <form id="application-form" className="application--form" onSubmit={e => { e.preventDefault(); setSubmitted(n => n + 1); }}>
      <div className="application--questions">
        <TextField id="first_name" label="First Name" required autoComplete="given-name" />
        <TextField id="last_name" label="Last Name" required autoComplete="family-name" />
        <TextField id="preferred_name" label="Preferred First Name" initial="Already typed" />
        <TextField id="email" label="Email" required autoComplete="email" />
        <fieldset className="phone-input">
          <legend className="visually-hidden">Phone</legend>
          <div className="phone-input__country">
            <SelectField id="country" label="Country" required options={opts(["Canada +1", "United States +1", "United States Minor Outlying Islands +1", "United Kingdom +44"])} />
          </div>
          <div className="phone-input__phone"><TextField id="phone" label="Phone" required type="tel" /></div>
        </fieldset>
        <SelectField id="candidate-location" label="Location (City)" required async
          options={opts(["San Francisco, California, United States", "San Francisco, Cordoba, Argentina", "South San Francisco, California, United States"])} />
        <FileField id="resume" label="Resume/CV" required />
        <FileField id="cover_letter" label="Cover Letter" />
      </div>

      <div className="education--container">
        <div className="education--form">
          <SelectField id="school--0" label="School" required async options={opts(SCHOOLS)} />
          <SelectField id="degree--0" label="Degree" required options={opts(["High School", "Associate's Degree", "Bachelor's Degree", "Master's Degree", "Master of Business Administration (M.B.A.)", "Doctor of Philosophy (Ph.D.)", "Other"])} />
          <SelectField id="discipline--0" label="Discipline" required options={opts(["Computer Science", "Computer Engineering", "Mathematics", "Economics"])} />
          <SelectField id="start-month--0" label="Start date month" required options={opts(MONTHS)} />
          <TextField id="start-year--0" label="Start date year" required type="number" />
          <SelectField id="end-month--0" label="End date month" required options={opts(MONTHS)} />
          <TextField id="end-year--0" label="End date year" required type="number" />
        </div>
        <button type="button" className="add-another-button">Add another</button>
      </div>

      <div className="custom-questions">
        <TextField id="question_1001" label="LinkedIn Profile" required />
        <TextField id="question_1002" label="Website" />
        <TextField id="question_1003" label="GitHub" />
        <SelectField id="question_1004" label="What is your expected graduation month & year?" required
          options={opts(["Already graduated", "Sept - Dec 2026", "Jan - April 2027", "May - Aug 2027", "Sept 2027 - Dec 2027", "Jan 2028 or later"])} />
        <SelectField id="question_1005" label="Are you willing to work four days per week in our San Francisco office?" required options={opts(["Yes", "No"])} />
        <SelectField id="question_1006" label="Are you legally authorized to work in the country where the job is located?" required
          options={opts(["Yes, I am currently legally authorized to work in the country where the jobs is located.", "No, I am not currently legally authorized to work in the country where the job is located."])} />
        <SelectField id="question_1007" label="Will you now or in the future require company sponsorship to retain or extend your work authorization in the country where the job is located?" required
          onPick={() => setSponsorAnswered(true)}
          options={opts(["Yes, I will require immigration sponsorship now to legally work in the country where the job is located.", "Yes, I will require immigration sponsorship in the future to legally work in the country where the job is located.", "No, I do not and will not require immigration sponsorship to legally work in the country where the job is located."])} />
        {sponsorAnswered ? <TextField id="question_1008" label="What is your earliest available start date?" /> : null}
        <SelectField id="question_1009" label="How did you hear about us?" required options={opts(["LinkedIn", "Company Website", "Employee/Intern referral", "Campus Event", "Other"])} />
        <SelectField id="question_1010" label="Have you ever worked for this company before, as an employee or a contractor/consultant?" required options={opts(["Yes", "No"])} />
        <SelectField id="question_1011" label="Terms & Conditions" required options={opts(["I have read and agree to the Privacy Policy"])} />
        <TextArea id="question_1012" label="Why do you want to join us?" required />
        <CheckboxGroup id="question_1013[]" legend="Undergrad Discipline(s)" required options={["Mathematics", "Computer Science", "Software Engineering", "Economics"]} />
        <TextField id="question_1014" label="If yes, please provide your visa type and expiration date." />
      </div>

      <div className="eeoc">
        <h2>Voluntary Self-Identification</h2>
        <SelectField id="gender" label="Gender" options={opts(["Male", "Female", "Decline To Self Identify"])} />
        <SelectField id="hispanic_ethnicity" label="Are you Hispanic/Latino?" options={opts(["Yes", "No", "Decline To Self Identify"])} />
        <SelectField id="veteran_status" label="Veteran Status" options={opts(["I am not a protected veteran", "I identify as one or more of the classifications of a protected veteran", "I don't wish to answer"])} />
        <SelectField id="disability_status" label="Disability Status" options={opts(["Yes, I have a disability, or have had one in the past", "No, I do not have a disability and have not had one in the past", "I do not want to answer"])} />
        <CheckboxGroup id="demographic_sexual_orientation" legend="How would you describe your sexual orientation? (mark all that apply)" options={["Asexual", "Gay", "Heterosexual", "I don't wish to answer"]} />
      </div>

      <button type="submit" className="btn btn--rounded">Submit application</button>
    </form>
  );
}

createRoot(document.getElementById("root")).render(<App />);
