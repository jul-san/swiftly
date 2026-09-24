import UIKit

final class ProfileSetupViewController: UIViewController {

    private let store: ProfileStoring

    // MARK: - Colors

    private enum C {
        static let background   = UIColor(hex: "#F4F4F5")
        static let surface      = UIColor.white
        static let border       = UIColor(hex: "#E4E4E7")
        static let borderFocus  = UIColor(hex: "#A1A1AA")
        static let textPrimary  = UIColor(hex: "#18181B")
        static let textSecondary = UIColor(hex: "#71717A")
        static let placeholder  = UIColor(hex: "#A1A1AA")
        static let accent       = UIColor(hex: "#2D6AFF")
        static let accentText   = UIColor.white
        static let destructive  = UIColor(hex: "#DC2626")
    }

    // MARK: - Fields

    private let firstNameField = StyledTextField(placeholder: "First name",                       contentType: .givenName)
    private let lastNameField  = StyledTextField(placeholder: "Last name",                        contentType: .familyName)
    private let emailField     = StyledTextField(placeholder: "Email",                            contentType: .emailAddress,    keyboard: .emailAddress)
    private let phoneField     = StyledTextField(placeholder: "Phone",                            contentType: .telephoneNumber, keyboard: .phonePad)
    private let locationField  = StyledTextField(placeholder: "Location (e.g. San Francisco, CA)", contentType: .addressCity)
    private let linkedinField  = StyledTextField(placeholder: "LinkedIn URL",                     contentType: .URL,             keyboard: .URL)
    private let githubField    = StyledTextField(placeholder: "GitHub URL",                       contentType: .URL,             keyboard: .URL)
    private let websiteField   = StyledTextField(placeholder: "Personal website",                 contentType: .URL,             keyboard: .URL)
    private let pronounsField = StyledTextField(placeholder: "Pronouns (e.g. she/her)")

    private let genderPicker = StyledPicker(options: [
        ("", "Gender identity"),
        ("Man",                      "Man"),
        ("Woman",                    "Woman"),
        ("Non-Binary",               "Non-Binary"),
        ("Another Gender Identity",  "Another Gender Identity"),
        ("Male",                     "Male"),
        ("Female",                   "Female"),
        ("I prefer not to answer",   "I prefer not to answer"),
        ("Decline to self-identify", "Decline to self-identify"),
    ])

    static let raceOptions: [(value: String, label: String)] = [
        ("Asian or Asian American",                  "Asian or Asian American"),
        ("Black or African American",                "Black or African American"),
        ("Hispanic or Latine",                       "Hispanic or Latine"),
        ("Indigenous or Native American",            "Indigenous or Native American"),
        ("Native Hawaiian or Other Pacific Islander","Native Hawaiian or Other Pacific Islander"),
        ("White",                                    "White"),
        ("Other",                                    "Other"),
        ("I prefer not to answer",                   "I prefer not to answer"),
    ]
    private var selectedRace: Set<String> = []

    private let workAuthPicker = StyledPicker(options: [
        ("",                     "Authorized to work in the US?"),
        ("Yes",                  "Yes"),
        ("No",                   "No"),
        ("Prefer not to answer", "Prefer not to answer"),
    ])
    private let sponsorshipPicker = StyledPicker(options: [
        ("",                     "Will you require visa sponsorship?"),
        ("Yes",                  "Yes"),
        ("No",                   "No"),
        ("Prefer not to answer", "Prefer not to answer"),
    ])
    private let veteranPicker = StyledPicker(options: [
        ("", "Veteran status"),
        ("I am not a protected veteran",                                                        "Not a protected veteran"),
        ("I identify as one or more of the classifications of protected veteran listed above",   "Protected veteran"),
        ("I decline to self-identify for protected veteran status",                             "Decline to self-identify"),
    ])
    private let disabilityPicker = StyledPicker(options: [
        ("",                                              "Disability status"),
        ("Yes, I Have A Disability, Or Have Had One In The Past", "Yes, I have a disability"),
        ("No, I Don't Have A Disability",                         "No"),
        ("I Don't Wish To Answer",                                "Prefer not to answer"),
    ])

    // MARK: - Views

    private lazy var scrollView: UIScrollView = {
        let sv = UIScrollView()
        sv.alwaysBounceVertical = true
        sv.keyboardDismissMode = .onDrag
        sv.translatesAutoresizingMaskIntoConstraints = false
        return sv
    }()

    private lazy var contentStack: UIStackView = {
        let sv = UIStackView()
        sv.axis = .vertical
        sv.spacing = 20
        sv.translatesAutoresizingMaskIntoConstraints = false
        return sv
    }()

    private lazy var errorLabel: UILabel = {
        let l = UILabel()
        l.font = .systemFont(ofSize: 13, weight: .regular)
        l.textColor = C.destructive
        l.numberOfLines = 0
        l.isHidden = true
        return l
    }()

    private lazy var saveButton: UIButton = {
        var config = UIButton.Configuration.filled()
        config.title = "Save profile"
        config.baseForegroundColor = C.accentText
        config.baseBackgroundColor = C.accent
        config.cornerStyle = .fixed
        config.background.cornerRadius = 8
        config.contentInsets = NSDirectionalEdgeInsets(top: 11, leading: 0, bottom: 11, trailing: 0)
        config.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { attrs in
            var a = attrs
            a.font = UIFont.systemFont(ofSize: 14, weight: .medium)
            return a
        }
        let btn = UIButton(configuration: config)
        btn.addTarget(self, action: #selector(saveTapped), for: .touchUpInside)
        return btn
    }()

    // MARK: - Init

    init(store: ProfileStoring) {
        self.store = store
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) not used") }

    // MARK: - Lifecycle

    override func viewDidLoad() {
        super.viewDidLoad()
        title = "Swiftly"
        view.backgroundColor = C.background
        styleNavigationBar()
        buildLayout()
        wireTextFields()
        loadExistingProfile()

        NotificationCenter.default.addObserver(
            self, selector: #selector(keyboardWillChange(_:)),
            name: UIResponder.keyboardWillChangeFrameNotification, object: nil)
        NotificationCenter.default.addObserver(
            self, selector: #selector(keyboardWillHide(_:)),
            name: UIResponder.keyboardWillHideNotification, object: nil)
    }

    // MARK: - Layout

    private func buildLayout() {
        view.addSubview(scrollView)
        scrollView.addSubview(contentStack)

        NSLayoutConstraint.activate([
            scrollView.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            scrollView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            scrollView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            scrollView.bottomAnchor.constraint(equalTo: view.bottomAnchor),

            contentStack.topAnchor.constraint(equalTo: scrollView.topAnchor, constant: 20),
            contentStack.leadingAnchor.constraint(equalTo: scrollView.leadingAnchor, constant: 16),
            contentStack.trailingAnchor.constraint(equalTo: scrollView.trailingAnchor, constant: -16),
            contentStack.bottomAnchor.constraint(equalTo: scrollView.bottomAnchor, constant: -32),
            contentStack.widthAnchor.constraint(equalTo: scrollView.widthAnchor, constant: -32),
        ])

        // Description card
        contentStack.addArrangedSubview(descriptionCard())

        // Name row
        contentStack.addArrangedSubview(fieldSection(
            label: "Name",
            content: nameRow()
        ))

        // Contact section
        contentStack.addArrangedSubview(fieldSection(
            label: "Contact",
            content: contactStack()
        ))

        // Links section
        contentStack.addArrangedSubview(fieldSection(
            label: "Links",
            optional: true,
            content: linksStack()
        ))

        // Work eligibility section
        contentStack.addArrangedSubview(fieldSection(
            label: "Work Eligibility",
            optional: true,
            content: workEligibilityStack()
        ))

        // Demographics section
        contentStack.addArrangedSubview(fieldSection(
            label: "Demographics",
            optional: true,
            content: demographicsStack()
        ))

        // Error + save
        let bottomStack = UIStackView(arrangedSubviews: [errorLabel, saveButton])
        bottomStack.axis = .vertical
        bottomStack.spacing = 8
        contentStack.addArrangedSubview(bottomStack)
    }

    private func descriptionCard() -> UIView {
        let card = CardView()

        let icon = UIImageView(image: UIImage(named: "icon-48"))
        icon.contentMode = .scaleAspectFit
        icon.layer.cornerRadius = 8
        icon.clipsToBounds = true
        icon.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            icon.widthAnchor.constraint(equalToConstant: 36),
            icon.heightAnchor.constraint(equalToConstant: 36),
        ])

        let titleLabel = UILabel()
        titleLabel.text = "Your autofill profile"
        titleLabel.font = .systemFont(ofSize: 15, weight: .semibold)
        titleLabel.textColor = C.textPrimary

        let subtitleLabel = UILabel()
        subtitleLabel.text = "Save your info once and Swiftly will fill it in on Ashby job applications."
        subtitleLabel.font = .systemFont(ofSize: 13, weight: .regular)
        subtitleLabel.textColor = C.textSecondary
        subtitleLabel.numberOfLines = 0
        subtitleLabel.lineBreakMode = .byWordWrapping

        let textStack = UIStackView(arrangedSubviews: [titleLabel, subtitleLabel])
        textStack.axis = .vertical
        textStack.spacing = 3

        let row = UIStackView(arrangedSubviews: [icon, textStack])
        row.axis = .horizontal
        row.alignment = .top
        row.spacing = 12
        row.translatesAutoresizingMaskIntoConstraints = false

        card.addSubview(row)
        NSLayoutConstraint.activate([
            row.topAnchor.constraint(equalTo: card.topAnchor, constant: 14),
            row.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 14),
            row.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -14),
            row.bottomAnchor.constraint(equalTo: card.bottomAnchor, constant: -14),
        ])
        return card
    }

    private func fieldSection(label: String, optional: Bool = false, content: UIView) -> UIView {
        let sectionLabel = UILabel()
        sectionLabel.font = .systemFont(ofSize: 11, weight: .medium)
        sectionLabel.setContentHuggingPriority(.required, for: .vertical)

        if optional {
            let attrs = NSMutableAttributedString(
                string: label.uppercased() + "  ",
                attributes: [.foregroundColor: C.textSecondary, .font: UIFont.systemFont(ofSize: 11, weight: .medium)]
            )
            attrs.append(NSAttributedString(
                string: "optional",
                attributes: [.foregroundColor: C.placeholder, .font: UIFont.systemFont(ofSize: 11, weight: .regular)]
            ))
            sectionLabel.attributedText = attrs
        } else {
            sectionLabel.text = label.uppercased()
            sectionLabel.textColor = C.textSecondary
        }

        let stack = UIStackView(arrangedSubviews: [sectionLabel, content])
        stack.axis = .vertical
        stack.spacing = 6
        return stack
    }

    private func nameRow() -> UIView {
        // Remove individual borders — the group container provides the border
        firstNameField.embedInGroup()
        lastNameField.embedInGroup()

        let row = UIStackView(arrangedSubviews: [firstNameField, lastNameField])
        row.axis = .horizontal
        row.spacing = 0
        row.distribution = .fillEqually

        // 0.5px gap between the two fields acts as a vertical divider
        let container = GroupContainer()
        row.translatesAutoresizingMaskIntoConstraints = false
        container.addSubview(row)
        NSLayoutConstraint.activate([
            row.topAnchor.constraint(equalTo: container.topAnchor),
            row.leadingAnchor.constraint(equalTo: container.leadingAnchor),
            row.trailingAnchor.constraint(equalTo: container.trailingAnchor),
            row.bottomAnchor.constraint(equalTo: container.bottomAnchor),
        ])

        // Vertical divider
        let div = UIView()
        div.backgroundColor = C.border
        div.translatesAutoresizingMaskIntoConstraints = false
        container.addSubview(div)
        NSLayoutConstraint.activate([
            div.widthAnchor.constraint(equalToConstant: 0.5),
            div.topAnchor.constraint(equalTo: container.topAnchor),
            div.bottomAnchor.constraint(equalTo: container.bottomAnchor),
            div.centerXAnchor.constraint(equalTo: container.centerXAnchor),
        ])

        return container
    }

    private func contactStack() -> UIView {
        emailField.embedInGroup()
        phoneField.embedInGroup()
        locationField.embedInGroup()

        let sep1 = separatorView()
        let sep2 = separatorView()
        let stack = UIStackView(arrangedSubviews: [emailField, sep1, phoneField, sep2, locationField])
        stack.axis = .vertical
        stack.spacing = 0

        let container = GroupContainer()
        stack.translatesAutoresizingMaskIntoConstraints = false
        container.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: container.topAnchor),
            stack.leadingAnchor.constraint(equalTo: container.leadingAnchor),
            stack.trailingAnchor.constraint(equalTo: container.trailingAnchor),
            stack.bottomAnchor.constraint(equalTo: container.bottomAnchor),
        ])
        return container
    }

    private func workEligibilityStack() -> UIView {
        return groupedPickerStack([workAuthPicker, sponsorshipPicker])
    }

    private func demographicsStack() -> UIView {
        pronounsField.embedInGroup()

        let pronounsContainer = GroupContainer()
        pronounsField.translatesAutoresizingMaskIntoConstraints = false
        pronounsContainer.addSubview(pronounsField)
        NSLayoutConstraint.activate([
            pronounsField.topAnchor.constraint(equalTo: pronounsContainer.topAnchor),
            pronounsField.leadingAnchor.constraint(equalTo: pronounsContainer.leadingAnchor),
            pronounsField.trailingAnchor.constraint(equalTo: pronounsContainer.trailingAnchor),
            pronounsField.bottomAnchor.constraint(equalTo: pronounsContainer.bottomAnchor),
        ])

        let pickerStack = groupedPickerStack([genderPicker, veteranPicker, disabilityPicker])
        let raceSection = labeledSection("Race / Ethnicity", content: raceMultiSelectView())

        let outer = UIStackView(arrangedSubviews: [pronounsContainer, pickerStack, raceSection])
        outer.axis = .vertical
        outer.spacing = 8
        return outer
    }

    private func labeledSection(_ title: String, content: UIView) -> UIView {
        let label = UILabel()
        label.text = title
        label.font = .systemFont(ofSize: 11, weight: .medium)
        label.textColor = C.textSecondary
        let stack = UIStackView(arrangedSubviews: [label, content])
        stack.axis = .vertical
        stack.spacing = 5
        return stack
    }

    private func raceMultiSelectView() -> UIView {
        let container = GroupContainer()
        let stack = UIStackView()
        stack.axis = .vertical
        stack.spacing = 0
        stack.translatesAutoresizingMaskIntoConstraints = false

        for (i, option) in ProfileSetupViewController.raceOptions.enumerated() {
            let row = makeRaceRow(value: option.value, label: option.label)
            stack.addArrangedSubview(row)
            if i < ProfileSetupViewController.raceOptions.count - 1 {
                stack.addArrangedSubview(separatorView())
            }
        }

        container.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: container.topAnchor),
            stack.leadingAnchor.constraint(equalTo: container.leadingAnchor),
            stack.trailingAnchor.constraint(equalTo: container.trailingAnchor),
            stack.bottomAnchor.constraint(equalTo: container.bottomAnchor),
        ])
        return container
    }

    private func makeRaceRow(value: String, label: String) -> UIView {
        let row = UIView()
        row.backgroundColor = .white
        row.translatesAutoresizingMaskIntoConstraints = false
        row.heightAnchor.constraint(equalToConstant: 40).isActive = true

        let checkmark = UIImageView(image: UIImage(systemName: "checkmark"))
        checkmark.tintColor = C.accent
        checkmark.contentMode = .scaleAspectFit
        checkmark.isHidden = !selectedRace.contains(value)
        checkmark.translatesAutoresizingMaskIntoConstraints = false
        checkmark.widthAnchor.constraint(equalToConstant: 14).isActive = true

        let text = UILabel()
        text.text = label
        text.font = .systemFont(ofSize: 13, weight: .regular)
        text.textColor = C.textPrimary
        text.translatesAutoresizingMaskIntoConstraints = false

        let hStack = UIStackView(arrangedSubviews: [text, checkmark])
        hStack.axis = .horizontal
        hStack.alignment = .center
        hStack.spacing = 8
        hStack.translatesAutoresizingMaskIntoConstraints = false

        row.addSubview(hStack)
        NSLayoutConstraint.activate([
            hStack.leadingAnchor.constraint(equalTo: row.leadingAnchor, constant: 12),
            hStack.trailingAnchor.constraint(equalTo: row.trailingAnchor, constant: -12),
            hStack.centerYAnchor.constraint(equalTo: row.centerYAnchor),
        ])

        let tap = UITapGestureRecognizer(target: self, action: #selector(raceRowTapped(_:)))
        row.addGestureRecognizer(tap)
        row.accessibilityValue = value
        return row
    }

    @objc private func raceRowTapped(_ gesture: UITapGestureRecognizer) {
        guard let row = gesture.view, let value = row.accessibilityValue else { return }
        if selectedRace.contains(value) {
            selectedRace.remove(value)
        } else {
            selectedRace.insert(value)
        }
        // Update checkmark visibility
        if let checkmark = (row.subviews.first?.subviews.last as? UIImageView) ??
                           (row.subviews.first as? UIStackView)?.arrangedSubviews.last as? UIImageView {
            checkmark.isHidden = !selectedRace.contains(value)
        }
        // Rebuild to refresh checkmarks
        refreshRaceRows(in: row.superview)
    }

    private func refreshRaceRows(in container: UIView?) {
        guard let stack = container as? UIStackView else { return }
        for view in stack.arrangedSubviews {
            guard let value = view.accessibilityValue,
                  let hStack = view.subviews.first as? UIStackView,
                  let checkmark = hStack.arrangedSubviews.last as? UIImageView
            else { continue }
            checkmark.isHidden = !selectedRace.contains(value)
        }
    }

    private func groupedPickerStack(_ pickers: [StyledPicker]) -> UIView {
        let container = GroupContainer()
        let stack = UIStackView()
        stack.axis = .vertical
        stack.spacing = 0
        stack.translatesAutoresizingMaskIntoConstraints = false

        for (i, picker) in pickers.enumerated() {
            stack.addArrangedSubview(picker)
            if i < pickers.count - 1 {
                stack.addArrangedSubview(separatorView())
            }
        }

        container.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: container.topAnchor),
            stack.leadingAnchor.constraint(equalTo: container.leadingAnchor),
            stack.trailingAnchor.constraint(equalTo: container.trailingAnchor),
            stack.bottomAnchor.constraint(equalTo: container.bottomAnchor),
        ])
        return container
    }

    private func linksStack() -> UIView {
        linkedinField.embedInGroup()
        githubField.embedInGroup()
        websiteField.embedInGroup()

        let sep1 = separatorView()
        let sep2 = separatorView()
        let stack = UIStackView(arrangedSubviews: [linkedinField, sep1, githubField, sep2, websiteField])
        stack.axis = .vertical
        stack.spacing = 0

        let container = GroupContainer()
        stack.translatesAutoresizingMaskIntoConstraints = false
        container.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: container.topAnchor),
            stack.leadingAnchor.constraint(equalTo: container.leadingAnchor),
            stack.trailingAnchor.constraint(equalTo: container.trailingAnchor),
            stack.bottomAnchor.constraint(equalTo: container.bottomAnchor),
        ])
        return container
    }

    private func separatorView() -> UIView {
        let v = UIView()
        v.backgroundColor = C.border
        v.translatesAutoresizingMaskIntoConstraints = false
        v.heightAnchor.constraint(equalToConstant: 0.5).isActive = true
        return v
    }

    // MARK: - Navigation bar

    private func styleNavigationBar() {
        guard let nav = navigationController else { return }
        let appearance = UINavigationBarAppearance()
        appearance.configureWithOpaqueBackground()
        appearance.backgroundColor = C.surface
        appearance.shadowColor = C.border
        appearance.titleTextAttributes = [
            .font: UIFont.systemFont(ofSize: 15, weight: .semibold),
            .foregroundColor: C.textPrimary,
        ]
        nav.navigationBar.standardAppearance = appearance
        nav.navigationBar.scrollEdgeAppearance = appearance
        nav.navigationBar.compactAppearance = appearance
    }

    // MARK: - Text field wiring

    private func wireTextFields() {
        let fields: [StyledTextField] = [
            firstNameField, lastNameField,
            emailField, phoneField, locationField,
            linkedinField, githubField, websiteField,
            pronounsField,
        ]
        fields.forEach { $0.delegate = self }
        fields.dropLast().forEach { $0.returnKeyType = .next }
        fields.last?.returnKeyType = .done
    }

    // MARK: - Load

    private func loadExistingProfile() {
        guard let profile = try? store.loadProfile() else { return }
        firstNameField.text = profile.personal.firstName
        lastNameField.text  = profile.personal.lastName
        emailField.text     = profile.personal.email
        phoneField.text     = profile.personal.phone
        locationField.text  = profile.personal.location
        linkedinField.text  = profile.personal.linkedinURL
        githubField.text    = profile.personal.githubURL
        websiteField.text   = profile.personal.website
        pronounsField.text             = profile.personal.pronouns
        genderPicker.selectedValue     = profile.personal.genderIdentity ?? ""
        workAuthPicker.selectedValue   = profile.personal.workAuthorization ?? ""
        sponsorshipPicker.selectedValue = profile.personal.requiresSponsorship ?? ""
        veteranPicker.selectedValue    = profile.personal.veteranStatus ?? ""
        disabilityPicker.selectedValue = profile.personal.disabilityStatus ?? ""
        selectedRace = Set((profile.personal.raceEthnicity ?? "").split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty })
    }

    // MARK: - Save

    @objc private func saveTapped() {
        view.endEditing(true)
        let firstName = (firstNameField.text ?? "").trimmingCharacters(in: .whitespaces)
        let lastName  = (lastNameField.text ?? "").trimmingCharacters(in: .whitespaces)
        guard !firstName.isEmpty, !lastName.isEmpty else {
            showError("First and last name are required.")
            return
        }
        hideError()

        var personal = PersonalInfo(fullName: "\(firstName) \(lastName)")
        personal.firstName          = firstName
        personal.lastName           = lastName
        personal.email              = (emailField.text    ?? "").nilIfEmpty
        personal.phone              = (phoneField.text    ?? "").nilIfEmpty
        personal.location           = (locationField.text ?? "").nilIfEmpty
        personal.linkedinURL        = (linkedinField.text ?? "").nilIfEmpty
        personal.githubURL          = (githubField.text   ?? "").nilIfEmpty
        personal.website            = (websiteField.text  ?? "").nilIfEmpty
        personal.pronouns            = (pronounsField.text ?? "").nilIfEmpty
        personal.genderIdentity      = genderPicker.selectedValue.nilIfEmpty
        personal.raceEthnicity       = selectedRace.sorted().joined(separator: ", ").nilIfEmpty
        personal.workAuthorization   = workAuthPicker.selectedValue.nilIfEmpty
        personal.requiresSponsorship = sponsorshipPicker.selectedValue.nilIfEmpty
        personal.veteranStatus       = veteranPicker.selectedValue.nilIfEmpty
        personal.disabilityStatus    = disabilityPicker.selectedValue.nilIfEmpty

        let profile = ApplicantProfile(personal: personal, sourceMetadata: SourceMetadata())
        do {
            try store.saveProfile(profile)
            showSavedConfirmation()
        } catch {
            showError(error.localizedDescription)
        }
    }

    private func showError(_ message: String) {
        errorLabel.text = message
        errorLabel.isHidden = false
    }

    private func hideError() {
        errorLabel.isHidden = true
    }

    private func showSavedConfirmation() {
        saveButton.configuration?.title = "Saved"
        saveButton.isEnabled = false
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) { [weak self] in
            self?.saveButton.configuration?.title = "Save profile"
            self?.saveButton.isEnabled = true
        }
    }

    // MARK: - Keyboard

    @objc private func keyboardWillChange(_ notification: Notification) {
        guard let frame = notification.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect,
              let duration = notification.userInfo?[UIResponder.keyboardAnimationDurationUserInfoKey] as? Double
        else { return }
        let inset = view.bounds.height - frame.origin.y
        UIView.animate(withDuration: duration) {
            self.scrollView.contentInset.bottom = max(inset, 0)
            self.scrollView.verticalScrollIndicatorInsets.bottom = max(inset, 0)
        }
    }

    @objc private func keyboardWillHide(_ notification: Notification) {
        guard let duration = notification.userInfo?[UIResponder.keyboardAnimationDurationUserInfoKey] as? Double else { return }
        UIView.animate(withDuration: duration) {
            self.scrollView.contentInset.bottom = 0
            self.scrollView.verticalScrollIndicatorInsets.bottom = 0
        }
    }
}

// MARK: - UITextFieldDelegate

extension ProfileSetupViewController: UITextFieldDelegate {
    func textFieldShouldReturn(_ textField: UITextField) -> Bool {
        let fields: [UITextField] = [
            firstNameField, lastNameField,
            emailField, phoneField, locationField,
            linkedinField, githubField, websiteField,
            pronounsField,
        ]
        if let i = fields.firstIndex(of: textField), i + 1 < fields.count {
            fields[i + 1].becomeFirstResponder()
        } else {
            textField.resignFirstResponder()
        }
        return true
    }
}

// MARK: - StyledTextField

private final class StyledTextField: UITextField {

    convenience init(placeholder: String) {
        self.init(placeholder: placeholder, contentType: nil, keyboard: .default)
    }

    init(placeholder: String, contentType: UITextContentType?, keyboard: UIKeyboardType = .default) {
        super.init(frame: .zero)
        self.placeholder = placeholder
        if let ct = contentType { self.textContentType = ct }
        self.keyboardType = keyboard
        self.autocorrectionType = .no
        self.autocapitalizationType = keyboard == .emailAddress ? .none : .words
        self.font = .systemFont(ofSize: 14, weight: .regular)
        self.textColor = UIColor(hex: "#18181B")
        self.backgroundColor = .white
        self.layer.cornerRadius = 8
        self.layer.borderWidth = 1
        self.layer.borderColor = UIColor(hex: "#E4E4E7").cgColor
        self.translatesAutoresizingMaskIntoConstraints = false
        self.heightAnchor.constraint(equalToConstant: 40).isActive = true

        attributedPlaceholder = NSAttributedString(
            string: placeholder,
            attributes: [.foregroundColor: UIColor(hex: "#A1A1AA")]
        )
    }

    required init?(coder: NSCoder) { fatalError() }

    override var intrinsicContentSize: CGSize {
        CGSize(width: super.intrinsicContentSize.width, height: 40)
    }

    override func textRect(forBounds bounds: CGRect) -> CGRect {
        bounds.insetBy(dx: 11, dy: 0)
    }

    override func editingRect(forBounds bounds: CGRect) -> CGRect {
        bounds.insetBy(dx: 11, dy: 0)
    }

    func embedInGroup() {
        layer.borderWidth = 0
        layer.cornerRadius = 0
        isEmbedded = true
    }

    private var isEmbedded = false

    override func becomeFirstResponder() -> Bool {
        let result = super.becomeFirstResponder()
        if !isEmbedded {
            layer.borderColor = UIColor(hex: "#2D6AFF").cgColor
            layer.borderWidth = 1.5
        }
        return result
    }

    override func resignFirstResponder() -> Bool {
        let result = super.resignFirstResponder()
        if !isEmbedded {
            layer.borderColor = UIColor(hex: "#E4E4E7").cgColor
            layer.borderWidth = 1
        }
        return result
    }
}

// MARK: - CardView

private final class CardView: UIView {
    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = .white
        layer.cornerRadius = 10
        layer.borderWidth = 1
        layer.borderColor = UIColor(hex: "#E4E4E7").cgColor
    }
    required init?(coder: NSCoder) { fatalError() }
}

// MARK: - StyledPicker

private final class StyledPicker: UIView {

    private let options: [(value: String, label: String)]
    private let button: UIButton

    var selectedValue: String = "" {
        didSet { updateButtonTitle() }
    }

    init(options: [(String, String)]) {
        self.options = options
        self.button = UIButton(type: .system)
        super.init(frame: .zero)
        backgroundColor = .white
        translatesAutoresizingMaskIntoConstraints = false
        heightAnchor.constraint(equalToConstant: 40).isActive = true

        button.translatesAutoresizingMaskIntoConstraints = false
        button.contentHorizontalAlignment = .leading
        button.titleLabel?.font = .systemFont(ofSize: 14, weight: .regular)
        button.tintColor = UIColor(hex: "#A1A1AA")
        addSubview(button)
        NSLayoutConstraint.activate([
            button.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 11),
            button.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -11),
            button.centerYAnchor.constraint(equalTo: centerYAnchor),
        ])

        updateButtonTitle()

        var menuItems: [UIAction] = []
        for option in options {
            let (value, label) = option
            menuItems.append(UIAction(title: label) { [weak self] _ in
                self?.selectedValue = value
                self?.button.tintColor = UIColor(hex: "#18181B")
            })
        }
        button.menu = UIMenu(children: menuItems)
        button.showsMenuAsPrimaryAction = true
    }

    required init?(coder: NSCoder) { fatalError() }

    private func updateButtonTitle() {
        let label = options.first(where: { $0.0 == selectedValue })?.1
            ?? options.first?.1
            ?? ""
        button.setTitle(label, for: .normal)
        button.tintColor = selectedValue.isEmpty
            ? UIColor(hex: "#A1A1AA")
            : UIColor(hex: "#18181B")
    }
}

// MARK: - GroupContainer

private final class GroupContainer: UIView {
    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = .white
        layer.cornerRadius = 8
        layer.borderWidth = 1
        layer.borderColor = UIColor(hex: "#E4E4E7").cgColor
        clipsToBounds = true
    }
    required init?(coder: NSCoder) { fatalError() }
}

// MARK: - UIColor hex init

private extension UIColor {
    convenience init(hex: String) {
        var s = hex.trimmingCharacters(in: .whitespacesAndNewlines)
        if s.hasPrefix("#") { s = String(s.dropFirst()) }
        var rgb: UInt64 = 0
        Scanner(string: s).scanHexInt64(&rgb)
        let r = CGFloat((rgb >> 16) & 0xFF) / 255
        let g = CGFloat((rgb >> 8)  & 0xFF) / 255
        let b = CGFloat(rgb         & 0xFF) / 255
        self.init(red: r, green: g, blue: b, alpha: 1)
    }
}

private extension String {
    var nilIfEmpty: String? { isEmpty ? nil : self }
}
